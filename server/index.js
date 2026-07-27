import express, {query} from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {Pool} from 'pg';
import {GoogleGenAI} from '@google/genai';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased to handle conversations with images

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/multi_agent_chat';
const pool = new Pool({ connectionString });

async function initDb() {
  // Create tables
  await pool.query(`
    create table if not exists agents (
      id text primary key,
      name text not null,
      master_prompt text not null,
      created_at bigint not null
    );

    -- Add model column if missing and enforce default
    alter table if exists agents add column if not exists model text;
    update agents set model = coalesce(model, 'gemini-2.5-flash');
    alter table if exists agents alter column model set not null;

    create table if not exists conversations (
      id text primary key,
      agent_id text not null references agents(id) on delete cascade,
      title text not null,
      messages jsonb not null,
      created_at bigint not null
    );

    create index if not exists idx_conversations_agent on conversations(agent_id);

    create table if not exists users (
      id text primary key,
      first_name text not null,
      last_name text,
      email text not null unique,
      password_hash text not null,
      created_at bigint not null
    );
    create unique index if not exists idx_users_email on users(email);

    -- Roles table and user_roles pivot
    create table if not exists roles (
      id text primary key,
      name text not null unique
    );

    create table if not exists user_roles (
      user_id text not null references users(id) on delete cascade,
      role_id text not null references roles(id) on delete cascade,
      primary key(user_id, role_id)
    );

    -- agents.role_id
    alter table if exists agents add column if not exists role_id text references roles(id);
  `);

  // Seed roles and migrate existing data
  const client = await pool.connect();
  try {
    await client.query('begin');

    // Ensure roles exist
    const roleNames = ['Dev','HR','Marketing','BD', 'Admin', 'HR Policies', 'Technoventures'];
    const roleMap = new Map();
    for (const rname of roleNames) {
      // try to get by name
      let r = await client.query('select id from roles where name = $1', [rname]);
      if (r.rowCount === 0) {
        const id = genId();
        await client.query('insert into roles(id, name) values($1,$2)', [id, rname]);
        roleMap.set(rname, id);
      } else {
        roleMap.set(rname, r.rows[0].id);
      }
    }

    const devRoleId = roleMap.get('Dev');

    // Assign Dev role to users missing any roles (migration default)
    const usersNoRole = await client.query(`
      select u.id from users u
      where not exists (select 1 from user_roles ur where ur.user_id = u.id)
    `);
    for (const row of usersNoRole.rows) {
      await client.query('insert into user_roles(user_id, role_id) values($1,$2) on conflict do nothing', [row.id, devRoleId]);
    }

    // Migrate existing agents without role_id to Dev
    await client.query('update agents set role_id = $1 where role_id is null', [devRoleId]);

    // Finally, enforce not null
    await client.query('alter table if exists agents alter column role_id set not null');

    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  // Seed admin user if configured
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminFirst = process.env.ADMIN_FIRST_NAME || 'Admin';
  const adminLast = process.env.ADMIN_LAST_NAME || '';
  if (adminEmail && adminPassword) {
    const existing = await pool.query('select id from users where email = $1', [adminEmail.toLowerCase()]);
    if (existing.rowCount === 0) {
      const id = genId();
      const createdAt = Date.now();
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        'insert into users(id, first_name, last_name, email, password_hash, created_at) values($1,$2,$3,$4,$5,$6)',
        [id, adminFirst, adminLast, adminEmail.toLowerCase(), passwordHash, createdAt]
      );
      console.log(`Seeded admin user ${adminEmail}`);
    }
  }
}

function genId() {
  // Simple unique ID based on time and randomness
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Auth routes and middleware
function signToken(user) {
  const payload = { sub: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const normEmail = String(email).toLowerCase();
    const result = await pool.query('select id, first_name, last_name, email, password_hash from users where email = $1', [normEmail]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body || {};
    if (!email || !password || !firstName) return res.status(400).json({ error: 'email, password, firstName, and lastName are required' });
    const normEmail = String(email).toLowerCase();
    const existing = await pool.query('select id from users where email = $1', [normEmail]);
    if (existing.rowCount > 0) return res.status(400).json({ error: 'Email already registered' });

    const client = await pool.connect();
    try {
      await client.query('begin');

      const id = genId();
      const createdAt = Date.now();
      const passwordHash = await bcrypt.hash(password, 10);

      await client.query(
        'insert into users (id, email, password_hash, first_name, last_name, created_at) values ($1, $2, $3, $4, $5, $6)',
        [id, normEmail, passwordHash, firstName, lastName, createdAt]
      );

      // Assign HR Policies role
      const roleResult = await client.query('select id from roles where name = $1', ['HR Policies']);
      if (roleResult.rowCount > 0) {
        await client.query(
          'insert into user_roles (user_id, role_id) values ($1, $2)',
          [id, roleResult.rows[0].id]
        );
      }

      await client.query('commit');
      res.status(201).json({id, email, firstName, lastName});
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to register' });
  }
});

function authMiddleware(req, res, next) {
  try {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (!auth || typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      console.log('Auth middleware failed: No valid Authorization header');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = auth.slice(7).trim();
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    console.error('Auth middleware failed: JWT verification error:', e.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    // Optionally fetch from DB to ensure user still exists
    const userId = req.user?.sub;
    const result = await pool.query('select id, first_name, last_name, email from users where id = $1', [userId]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Unauthorized' });
    const u = result.rows[0];
    res.json({ id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      select u.id, u.first_name, u.last_name, u.email, u.created_at,
             array_agg(r.id) as role_ids,
             array_agg(r.name) as role_names
      from users u
      left join user_roles ur on ur.user_id = u.id
      left join roles r on r.id = ur.role_id
      group by u.id, u.first_name, u.last_name, u.email, u.created_at
      order by u.created_at desc
    `);
    res.json(result.rows.map(u => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      createdAt: u.created_at,
      roles: u.role_ids.map((id, i) => ({
        id,
        name: u.role_names[i]
      })).filter(r => r.id !== null)
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({error: 'Failed to fetch users'});
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {email, password, firstName, lastName, roleIds} = req.body || {};
    if (!email || !password || !firstName) {
      return res.status(400).json({error: 'Email, password and firstName are required'});
    }
    if (password.length < 8) {
      return res.status(400).json({error: 'Password must be at least 8 characters'});
    }
    const normEmail = String(email).toLowerCase();
    const existing = await pool.query('select id from users where email = $1', [normEmail]);
    if (existing.rowCount > 0) {
      return res.status(400).json({error: 'Email already registered'});
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      // Create user
      const id = genId();
      const createdAt = Date.now();
      const passwordHash = await bcrypt.hash(password, 10);
      await client.query(
        'insert into users(id, email, password_hash, first_name, last_name, created_at) values($1,$2,$3,$4,$5,$6)',
        [id, normEmail, passwordHash, firstName, lastName || '', createdAt]
      );

      // Assign roles if provided
      if (Array.isArray(roleIds) && roleIds.length > 0) {
        const roles = await client.query('select id from roles where id = any($1)', [roleIds]);
        if (roles.rowCount !== roleIds.length) {
          throw new Error('Invalid role IDs');
        }
        for (const roleId of roleIds) {
          await client.query(
            'insert into user_roles(user_id, role_id) values($1,$2)',
            [id, roleId]
          );
        }
      }

      await client.query('commit');

      // Return created user with roles
      const result = await pool.query(`
        select u.id,
               u.first_name,
               u.last_name,
               u.email,
               u.created_at,
               array_agg(r.id)   as role_ids,
               array_agg(r.name) as role_names
        from users u
               left join user_roles ur on ur.user_id = u.id
               left join roles r on r.id = ur.role_id
        where u.id = $1
        group by u.id, u.first_name, u.last_name, u.email, u.created_at
      `, [id]);

      const u = result.rows[0];
      res.status(201).json({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        createdAt: u.created_at,
        roles: u.role_ids.map((id, i) => ({
          id,
          name: u.role_names[i]
        })).filter(r => r.id !== null)
      });
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message || 'Failed to create user'});
  }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {id} = req.params;
    const {firstName, lastName, email, password, roleIds} = req.body || {};

    const client = await pool.connect();
    try {
      await client.query('begin');

      // Validate user exists
      const existing = await client.query('select id from users where id = $1', [id]);
      if (existing.rowCount === 0) {
        return res.status(404).json({error: 'User not found'});
      }

      // Update basic info
      if (firstName !== undefined || lastName !== undefined || email !== undefined) {
        const normEmail = email?.toLowerCase();
        if (email) {
          const emailExists = await client.query('select id from users where email = $1 and id != $2', [normEmail, id]);
          if (emailExists.rowCount > 0) {
            return res.status(400).json({error: 'Email already in use'});
          }
        }
        await client.query(
          'update users set first_name = coalesce($1, first_name), last_name = coalesce($2, last_name), email = coalesce($3, email) where id = $4',
          [firstName, lastName, normEmail, id]
        );
      }

      // Update password if provided
      if (password) {
        if (password.length < 8) {
          return res.status(400).json({error: 'Password must be at least 8 characters'});
        }
        const passwordHash = await bcrypt.hash(password, 10);
        await client.query('update users set password_hash = $1 where id = $2', [passwordHash, id]);
      }

      // Update roles if provided
      if (Array.isArray(roleIds)) {
        const roles = await client.query('select id from roles where id = any($1)', [roleIds]);
        if (roles.rowCount !== roleIds.length) {
          return res.status(400).json({error: 'Invalid role IDs'});
        }
        await client.query('delete from user_roles where user_id = $1', [id]);
        for (const roleId of roleIds) {
          await client.query(
            'insert into user_roles(user_id, role_id) values($1,$2)',
            [id, roleId]
          );
        }
      }

      await client.query('commit');

      // Return updated user
      const result = await client.query(`
        select u.id, u.first_name, u.last_name, u.email, u.created_at,
               array_agg(r.id) as role_ids,
               array_agg(r.name) as role_names
        from users u
        left join user_roles ur on ur.user_id = u.id
        left join roles r on r.id = ur.role_id
        where u.id = $1
        group by u.id, u.first_name, u.last_name, u.email, u.created_at
      `, [id]);

      const u = result.rows[0];
      res.json({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        createdAt: u.created_at,
        roles: u.role_ids.map((id, i) => ({
          id,
          name: u.role_names[i]
        })).filter(r => r.id !== null)
      });
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message || 'Failed to update user'});
  }
});

app.put('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.sub;
    const {firstName, lastName, password, roleIds} = req.body || {};

    const client = await pool.connect();
    try {
      await client.query('begin');

      // Update basic info
      if (firstName !== undefined || lastName !== undefined) {
        await client.query(
          'update users set first_name = coalesce($1, first_name), last_name = coalesce($2, last_name) where id = $3',
          [firstName, lastName, userId]
        );
      }

      // Update password if provided
      if (password) {
        if (password.length < 8) {
          return res.status(400).json({error: 'Password must be at least 8 characters'});
        }
        const passwordHash = await bcrypt.hash(password, 10);
        await client.query('update users set password_hash = $1 where id = $2', [passwordHash, userId]);
      }

      // Update roles if provided
      if (Array.isArray(roleIds)) {
        // Validate roles exist
        const roles = await client.query('select id from roles where id = any($1)', [roleIds]);
        if (roles.rowCount !== roleIds.length) {
          return res.status(400).json({error: 'Invalid role IDs'});
        }

        // Replace roles
        await client.query('delete from user_roles where user_id = $1', [userId]);
        for (const roleId of roleIds) {
          await client.query(
            'insert into user_roles(user_id, role_id) values($1, $2)',
            [userId, roleId]
          );
        }
      }

      await client.query('commit');

      const result = await client.query(
        'select u.id, u.first_name, u.last_name, u.email, array_agg(r.id) as role_ids, array_agg(r.name) as role_names from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id where u.id = $1 group by u.id, u.first_name, u.last_name, u.email',
        [userId]
      );

      if (result.rowCount === 0) return res.status(404).json({error: 'User not found'});
      const u = result.rows[0];
      res.json({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        roles: u.role_ids.map((id, i) => ({
          id,
          name: u.role_names[i]
        })).filter((r) => r.id)
      });

    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({error: 'Failed to update user'});
  }
});

// Protect all /api routes except login
// Admin role check middleware
async function adminOnly(req, res, next) {
  try {
    const userId = req.user?.sub;
    const admin = await pool.query(
      'select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 and r.name = $2',
      [userId, 'Admin']
    );
    if (admin.rowCount === 0) return res.status(403).json({error: 'Admin access required'});
    return next();
  } catch (e) {
    return res.status(500).json({error: 'Authorization check failed'});
  }
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/api/auth/login') return next();
  if (req.path === '/api/auth/register') return next();
  return authMiddleware(req, res, next);
});

// Roles APIs
app.get('/api/roles', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const result = await pool.query(
      `select r.id, r.name from roles r
         where exists (select 1 from user_roles ur where ur.user_id = $1 and ur.role_id = r.id)
         order by r.name asc`,
      [userId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Agents APIs
app.get('/api/agents', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const roleId = req.query.roleId;
    const stmt =
      `select a.id, a.name, a.master_prompt as "masterPrompt", a.model as "model", a.created_at as "createdAt",
        a.role_id as "roleId", r.name as "roleName"
        from agents a
        join roles r on r.id = a.role_id
        where exists (
          select 1 from user_roles ur where ur.user_id = $1 and ur.role_id = a.role_id
        ) ${roleId ? 'and a.role_id = $2' : ''}
        order by a.created_at asc`
    const result = await pool.query(stmt, roleId ? [userId, roleId] : [userId]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { name, masterPrompt, model, roleId } = req.body || {};
    if (!name || !masterPrompt) return res.status(400).json({ error: 'name and masterPrompt are required' });

    // Determine role
    const rolesRes = await pool.query('select role_id from user_roles where user_id = $1', [userId]);
    if (rolesRes.rowCount === 0) return res.status(403).json({ error: 'User has no roles assigned' });
    let finalRoleId = roleId;
    if (rolesRes.rowCount === 1) {
      finalRoleId = rolesRes.rows[0].role_id;
    } else {
      if (!roleId) return res.status(400).json({ error: 'roleId is required for users with multiple roles' });
      const ok = rolesRes.rows.some(r => r.role_id === roleId);
      if (!ok) return res.status(403).json({ error: 'Invalid roleId for this user' });
    }

    const id = genId();
    const createdAt = Date.now();
    const modelName = (model && typeof model === 'string' && model.trim()) ? model.trim() : 'gemini-2.5-flash';
    await pool.query('insert into agents(id, name, master_prompt, model, created_at, role_id) values($1,$2,$3,$4,$5,$6)', [id, name, masterPrompt, modelName, createdAt, finalRoleId]);
    const roleRow = await pool.query('select name from roles where id = $1', [finalRoleId]);
    res.status(201).json({ id, name, masterPrompt, model: modelName, createdAt, roleId: finalRoleId, roleName: roleRow.rows[0]?.name || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { id } = req.params;
    // Ensure user has access to this agent (by role)
    const can = await pool.query(
      `select 1 from agents a
        where a.id = $1 and exists (
          select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
        )`, [id, userId]
    );
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });

    const { name, masterPrompt, model } = req.body || {};
    const modelName = (model && typeof model === 'string' && model.trim()) ? model.trim() : 'gemini-2.5-flash';
    await pool.query('update agents set name = $1, master_prompt = $2, model = $3 where id = $4', [name, masterPrompt, modelName, id]);
    const result = await pool.query(`select a.id, a.name, a.master_prompt as "masterPrompt", a.model as "model", a.created_at as "createdAt", a.role_id as "roleId", r.name as "roleName" from agents a join roles r on r.id = a.role_id where a.id = $1`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { id } = req.params;
    const can = await pool.query(
      `select 1 from agents a where a.id = $1 and exists (
         select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
       )`, [id, userId]
    );
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('delete from agents where id = $1', [id]);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

app.post('/api/agents/:id/duplicate', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { id } = req.params;
    // Ensure user can access the source agent
    const orig = await pool.query('select id, name, master_prompt, model, created_at, role_id from agents where id = $1', [id]);
    if (orig.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
    const src = orig.rows[0];
    const can = await pool.query('select 1 from user_roles where user_id = $1 and role_id = $2', [userId, src.role_id]);
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const newId = genId();
    const createdAt = Date.now();
    const name = `${src.name} (Copy)`;
    await pool.query('insert into agents(id, name, master_prompt, model, created_at, role_id) values($1,$2,$3,$4,$5,$6)', [newId, name, src.master_prompt, src.model, createdAt, src.role_id]);
    const roleRow = await pool.query('select name from roles where id = $1', [src.role_id]);
    res.status(201).json({ id: newId, name, masterPrompt: src.master_prompt, model: src.model, createdAt, roleId: src.role_id, roleName: roleRow.rows[0]?.name || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to duplicate agent' });
  }
});

// Conversation APIs
app.get('/api/agents/:agentId/conversations', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { agentId } = req.params;
    const can = await pool.query(
      `select 1 from agents a where a.id = $1 and exists (
         select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
       )`, [agentId, userId]
    );
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      'select id, title, messages, created_at as "createdAt" from conversations where agent_id = $1 order by created_at asc',
      [agentId]
    );
    // Normalize messages to array of {role, content}
    const rows = result.rows.map(r => ({ ...r, messages: r.messages }));
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

app.put('/api/agents/:agentId/conversations', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { agentId } = req.params;
    const { conversations } = req.body || {};
    if (!Array.isArray(conversations)) return res.status(400).json({ error: 'conversations must be an array' });

    const can = await pool.query(
      `select 1 from agents a where a.id = $1 and exists (
         select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
       )`, [agentId, userId]
    );
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from conversations where agent_id = $1', [agentId]);
      for (const conv of conversations) {
        const id = conv.id || genId();
        const title = conv.title || '';
        const messages = JSON.stringify(conv.messages || []);
        const createdAt = conv.createdAt || Date.now();
        await client.query(
          'insert into conversations(id, agent_id, title, messages, created_at) values($1,$2,$3,$4::jsonb,$5)',
          [id, agentId, title, messages, createdAt]
        );
      }
      await client.query('commit');
      res.json({ ok: true });
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to replace conversations' });
  }
});

app.post('/api/agents/:agentId/conversations', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { agentId } = req.params;
    const can = await pool.query(
      `select 1 from agents a where a.id = $1 and exists (
         select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
       )`, [agentId, userId]
    );
    if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const { conversation } = req.body || {};
    if (!conversation) return res.status(400).json({ error: 'conversation is required' });
    const id = conversation.id || genId();
    const createdAt = conversation.createdAt || Date.now();
    const title = conversation.title || '';
    const messages = JSON.stringify(conversation.messages || []);
    await pool.query(
      'insert into conversations(id, agent_id, title, messages, created_at) values($1,$2,$3,$4::jsonb,$5)',
      [id, agentId, title, messages, createdAt]
    );
    res.status(201).json({ id, createdAt, title, messages: JSON.parse(messages) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// File upload (attachments) setup: in-memory buffers, 50 MB per file
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024, files: 10 } });

// Unified chat streaming proxy endpoint (supports JSON and multipart/form-data with files)
app.post('/api/chat/stream', (req, res, next) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    upload.array('files', 10)(req, res, (err) => {
      if (err) {
        const msg = (err && err.code === 'LIMIT_FILE_SIZE') ? 'File too large. Max 50 MB per file' : (err?.message || 'Upload error');
        return res.status(400).json({ error: msg });
      }
      next();
    });
  } else {
    next();
  }
}, async (req, res) => {
  let agent = null;
  let messages = null;
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const hasFiles = Array.isArray(req.files) && req.files.length > 0;
  if (ct.includes('multipart/form-data') || hasFiles) {
    try { agent = JSON.parse(req.body?.agent || ''); } catch {}
    try { messages = JSON.parse(req.body?.messages || ''); } catch {}
  } else {
    ({ agent, messages } = req.body || {});
  }

  if (!agent || !agent.masterPrompt || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'agent.masterPrompt and messages are required' });
  }

  // Authorization: if agent.id is provided, ensure the user can access this agent by role
  try {
    if (agent.id) {
      const userId = req.user?.sub;
      const can = await pool.query(
        `select 1 from agents a where a.id = $1 and exists (
           select 1 from user_roles ur where ur.user_id = $2 and ur.role_id = a.role_id
         )`, [agent.id, userId]
      );
      if (can.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Authorization check failed' });
  }

  const model = (agent.model && typeof agent.model === 'string' && agent.model.trim()) ? agent.model.trim() : 'gemini-2.5-flash';
  const m = model.toLowerCase();
  const isVeoModel = m.includes('veo-3.1-generate-preview') || m === 'veo-3.1-generate-preview';
  const isNanoBananaModel = m === 'gemini-3-pro-image-preview' || m === 'gemini-2.5-flash-image';
  const provider = m.includes('claude') ? 'anthropic' : (m.includes('gemini') || isVeoModel ? 'gemini' : 'openai');

  // Headers for streaming NDJSON
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Set up abort controller for upstream requests
  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  try {
    // Disable Veo and Nano Banana models
    if (isVeoModel || isNanoBananaModel) {
      return res.status(400).json({ error: 'This model is not available.' });
    }
    
    if (isVeoModel) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY not set' });

      const ai = new GoogleGenAI({ apiKey });

      // Extract prompt from the last user message
      let prompt = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && messages[i].content) {
          prompt = messages[i].content.trim();
          break;
        }
      }

      // Combine with master prompt if available
      if (agent.masterPrompt && agent.masterPrompt.trim()) {
        prompt = `${agent.masterPrompt}\n\n${prompt}`;
      }

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required for video generation' });
      }

      try {
        // Generate video using Veo model
        // Try different possible API methods
        let videoResponse = null;
        let videoError = null;

        // Try ai.models.generateVideos() first
        try {
          if (typeof ai.models.generateVideos === 'function') {
            videoResponse = await ai.models.generateVideos({
              model: model,
              prompt: prompt,
            });
          }
        } catch (e) {
          videoError = e;
        }

        // If that didn't work, try ai.generateVideos()
        if (!videoResponse && videoError) {
          try {
            if (typeof ai.generateVideos === 'function') {
              videoResponse = await ai.generateVideos({
                model: model,
                prompt: prompt,
              });
            }
          } catch (e) {
            videoError = e;
          }
        }

        // If still no response, try using generateContent with video model
        if (!videoResponse) {
          try {
            // Some APIs might use generateContent for video models
            const contents = [{ role: 'user', parts: [{ text: prompt }] }];
            const response = await ai.models.generateContent({
              model: model,
              contents: contents,
              config: agent.masterPrompt ? { systemInstruction: agent.masterPrompt } : undefined,
            });
            videoResponse = response;
          } catch (e) {
            videoError = e;
          }
        }

        if (!videoResponse) {
          throw new Error(`Video generation API not found. Error: ${videoError?.message || 'Unknown error'}`);
        }

        // Check if response is a long-running operation (videoResponse should be the operation object)
        if (videoResponse && typeof videoResponse === 'object' && videoResponse.name && videoResponse.name.includes('operations/')) {
          // This is a long-running operation, need to poll for result
          console.log('Video generation operation started:', videoResponse.name);
          
          // Send initial status to frontend
          res.write(JSON.stringify({
            text: 'Video generation started. This may take some time...'
          }) + '\n');

          // Poll the operation until it's complete using the correct SDK method
          let operation = videoResponse;
          let pollAttempts = 0;
          const maxPollAttempts = 120; // 10 minutes max (10 second intervals)
          const pollInterval = 10000; // 10 seconds (as per example)

          while (!operation.done && pollAttempts < maxPollAttempts) {
            // Wait before polling
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            
            // Poll the operation status using the correct SDK method
            try {
              operation = await ai.operations.getVideosOperation({
                operation: operation,
              });
              
              // Send progress update every 30 seconds (every 3 polls)
              if (pollAttempts % 3 === 0 && pollAttempts > 0) {
                res.write(JSON.stringify({
                  text: `\n\nStill generating video... (${Math.floor(pollAttempts * pollInterval / 1000)}s elapsed)`
                }) + '\n');
              }
              
              pollAttempts++;
            } catch (pollError) {
              console.error('Error polling operation:', pollError);
              // If it's a fatal error, throw it
              if (pollError.message && !pollError.message.includes('ECONNREFUSED')) {
                throw pollError;
              }
              // Otherwise wait and retry
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
              pollAttempts++;
            }
          }

          if (!operation.done) {
            throw new Error('Video generation timed out after 10 minutes');
          }

          if (operation.error) {
            throw new Error(operation.error.message || 'Operation failed');
          }
          
          // Extract video from operation.response.generatedVideos[0].video
          if (operation.response && operation.response.generatedVideos && operation.response.generatedVideos.length > 0) {
            const video = operation.response.generatedVideos[0].video;
            
            // Download the video file on the backend (frontend can't access Google API URLs directly)
            // This ensures the video can be displayed in the frontend without authentication issues
            try {
              // Extract URI from video object or construct from name
              let videoUri = video.uri || video.fileUri || video.downloadUri || video.url || video.downloadUrl;
              
              if (!videoUri && video.name) {
                // Construct the download URL from the file name
                videoUri = `https://generativelanguage.googleapis.com/v1beta/${video.name}:download?alt=media`;
              }
              
              if (!videoUri) {
                throw new Error('Video object does not contain a URI or name for download');
              }
              
              // Fetch the video using the API key as a query parameter
              const urlObj = new URL(videoUri);
              urlObj.searchParams.set('key', apiKey);
              const authenticatedUri = urlObj.toString();
              
              const fetchResponse = await fetch(authenticatedUri, {
                headers: {
                  'Accept': 'video/*, */*',
                },
              });
              
              if (!fetchResponse.ok) {
                const errorText = await fetchResponse.text().catch(() => '');
                throw new Error(`Failed to fetch video: HTTP ${fetchResponse.status} - ${errorText}`);
              }
              
              const arrayBuffer = await fetchResponse.arrayBuffer();
              const videoBuffer = Buffer.from(arrayBuffer);
              
              // Convert buffer to base64 and stream to frontend
              const base64Data = videoBuffer.toString('base64');
              
              res.write(JSON.stringify({
                video: {
                  data: base64Data,
                  mimeType: video.mimeType || 'video/mp4',
                  name: 'generated-video.mp4'
                }
              }) + '\n');
            } catch (downloadError) {
              console.error('Error downloading video:', downloadError);
              const errorMessage = downloadError?.message || downloadError?.toString() || 'Unknown error';
              res.write(JSON.stringify({
                text: `\n\nVideo generation completed, but could not retrieve video: ${errorMessage}. Please check server logs.`
              }) + '\n');
            }
          } else {
            console.error('No generatedVideos found in operation response');
            res.write(JSON.stringify({
              text: '\n\nVideo generation completed, but video data format is not recognized. Please check server logs.'
            }) + '\n');
          }
          
          res.write(JSON.stringify({ done: true }) + '\n');
          return res.end();
        }

        // Handle different response formats
        let videoUrl = null;
        let videoData = null;
        let videoMimeType = 'video/mp4';

        // Helper function to extract video from response
        const extractVideo = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          
          // Check for URL fields
          if (obj.videoUri || obj.uri || obj.url || obj.videoUrl) {
            return { url: obj.videoUri || obj.uri || obj.url || obj.videoUrl, mimeType: obj.mimeType || 'video/mp4' };
          }
          
          // Check for data fields
          if (obj.videoData || obj.data || obj.video) {
            const data = obj.videoData || obj.data || obj.video;
            return { data, mimeType: obj.mimeType || obj.mime_type || 'video/mp4' };
          }
          
          // Check for generatedVideos array (common in Google video APIs)
          if (obj.generatedVideos && Array.isArray(obj.generatedVideos) && obj.generatedVideos.length > 0) {
            const firstVideo = obj.generatedVideos[0];
            if (firstVideo.videoUri || firstVideo.uri || firstVideo.url) {
              return { url: firstVideo.videoUri || firstVideo.uri || firstVideo.url, mimeType: firstVideo.mimeType || 'video/mp4' };
            }
            if (firstVideo.videoData || firstVideo.data) {
              return { data: firstVideo.videoData || firstVideo.data, mimeType: firstVideo.mimeType || 'video/mp4' };
            }
          }
          
          // Check for videos array
          if (obj.videos && Array.isArray(obj.videos) && obj.videos.length > 0) {
            const firstVideo = obj.videos[0];
            if (firstVideo.videoUri || firstVideo.uri || firstVideo.url) {
              return { url: firstVideo.videoUri || firstVideo.uri || firstVideo.url, mimeType: firstVideo.mimeType || 'video/mp4' };
            }
            if (firstVideo.videoData || firstVideo.data) {
              return { data: firstVideo.videoData || firstVideo.data, mimeType: firstVideo.mimeType || 'video/mp4' };
            }
          }
          
          return null;
        };

        // Try to extract video from response
        let videoInfo = extractVideo(videoResponse);
        
        // Check nested structures
        if (!videoInfo && videoResponse.response) {
          videoInfo = extractVideo(videoResponse.response);
        }
        
        // Check result field
        if (!videoInfo && videoResponse.result) {
          videoInfo = extractVideo(videoResponse.result);
        }
        
        // Check candidates array (common in Google APIs)
        if (!videoInfo && videoResponse.candidates && Array.isArray(videoResponse.candidates) && videoResponse.candidates.length > 0) {
          videoInfo = extractVideo(videoResponse.candidates[0]);
        }
        
        // Check if response is an array
        if (!videoInfo && Array.isArray(videoResponse) && videoResponse.length > 0) {
          videoInfo = extractVideo(videoResponse[0]);
        }
        
        // Check content.parts structure
        if (!videoInfo && videoResponse.content?.parts) {
          for (const part of videoResponse.content.parts) {
            const info = extractVideo(part);
            if (info) {
              videoInfo = info;
              break;
            }
          }
        }

        // Stream video information to frontend
        if (videoInfo?.url) {
          res.write(JSON.stringify({
            video: {
              data: videoInfo.url,
              mimeType: videoInfo.mimeType,
              name: 'generated-video.mp4'
            }
          }) + '\n');
        } else if (videoInfo?.data) {
          // If videoData is base64, send as-is; if it's a buffer, convert to base64
          const base64Data = Buffer.isBuffer(videoInfo.data) 
            ? videoInfo.data.toString('base64')
            : (typeof videoInfo.data === 'string' ? videoInfo.data : Buffer.from(videoInfo.data).toString('base64'));
          
          res.write(JSON.stringify({
            video: {
              data: base64Data,
              mimeType: videoInfo.mimeType,
              name: 'generated-video.mp4'
            }
          }) + '\n');
        } else {
          // Log the response structure for debugging
          console.log('Veo response structure (first 2000 chars):', JSON.stringify(videoResponse, null, 2).substring(0, 2000));
          res.write(JSON.stringify({
            text: `Video generation completed, but video data format is not recognized. Response structure logged to server.`
          }) + '\n');
        }

        res.write(JSON.stringify({ done: true }) + '\n');
        return res.end();
      } catch (videoError) {
        console.error('Video generation error:', videoError);
        // Don't try to send JSON response if we've already started streaming
        if (!res.headersSent) {
          return res.status(500).json({ error: `Video generation failed: ${videoError.message || 'Unknown error'}` });
        } else {
          // Already streaming, send error as text chunk
          res.write(JSON.stringify({
            text: `Error: Video generation failed: ${videoError.message || 'Unknown error'}`
          }) + '\n');
          res.write(JSON.stringify({ done: true }) + '\n');
          return res.end();
        }
      }
    }

    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY not set' });

      const ai = new GoogleGenAI({ apiKey });

      // Build contents and merge any uploaded files into the last user message as inlineData
      const files = Array.isArray(req.files) ? req.files : [];
      const contents = messages.map((msg) => {
        const youtubeUrl = msg.content?.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([^\s&]+)/)?.[0];
        if (youtubeUrl) {
          return {
            role: msg.role,
            parts: [
              {
                fileData: {
                  fileUri: youtubeUrl,
                  mimeType: "video/mp4"
                }
              },
              {
                text: msg.content
              }
            ]
          };
        }
        return {
          role: msg.role,
          parts: msg.content ? [{text: msg.content}] : [],
        };
      });

      if (files.length > 0) {
        let lastUserIdx = -1;
        for (let i = contents.length - 1; i >= 0; i--) {
          if (contents[i].role === 'user') { lastUserIdx = i; break; }
        }
        const fileParts = files.map((f) => ({
          inlineData: {
            data: Buffer.from(f.buffer).toString('base64'),
            mimeType: f.mimetype || 'application/octet-stream',
          }
        }));
        if (lastUserIdx >= 0) {
          contents[lastUserIdx].parts = [...(contents[lastUserIdx].parts || []), ...fileParts];
        } else {
          contents.push({ role: 'user', parts: fileParts });
        }
      }

      const stream = await ai.models.generateContentStream({
        model: model,
        contents,
        config: { systemInstruction: agent.masterPrompt },
      });

      // Accumulate all chunks to check final response for images
      const allChunks = [];
      // Track sent images/files to avoid duplicates
      const sentImages = new Set();
      const sentFiles = new Set();
      
      // Helper to create a unique key for an image/file
      const getImageKey = (data) => {
        // Use first 100 chars of data as key (base64 images have unique starts)
        return typeof data === 'string' ? data.substring(0, 100) : String(data).substring(0, 100);
      };
      
      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        allChunks.push(chunk);
        
        // Debug: log chunk structure to help diagnose image generation issues
        const chunkStr = JSON.stringify(chunk);
        if (chunkStr.length > 0 && chunkStr !== '{}') {
          console.log('Gemini chunk keys:', Object.keys(chunk));
          // Log a sample of the chunk structure (truncated to avoid huge logs)
          if (chunkStr.length < 2000) {
            console.log('Gemini chunk sample:', chunkStr.substring(0, 2000));
          } else {
            console.log('Gemini chunk (large, first 500 chars):', chunkStr.substring(0, 500));
          }
        }
        
        // Handle text content
        const text = chunk?.text ?? '';
        if (text) {
          res.write(JSON.stringify({ text }) + '\n');
        }
        
        // Helper function to extract image/file data from a part
        const processPart = (part) => {
          if (!part) return false;
          
          // Check for inlineData (base64 image data)
          if (part.inlineData) {
            const imageKey = getImageKey(part.inlineData.data);
            if (!sentImages.has(imageKey)) {
              sentImages.add(imageKey);
              res.write(JSON.stringify({
                image: {
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType || 'image/png'
                }
              }) + '\n');
              return true;
            }
            return false;
          }
          
          // Check for fileData (file URI/reference)
          if (part.fileData) {
            const fileKey = part.fileData.fileUri;
            if (!sentFiles.has(fileKey)) {
              sentFiles.add(fileKey);
              res.write(JSON.stringify({
                file: {
                  data: part.fileData.fileUri,
                  mimeType: part.fileData.mimeType || 'application/octet-stream',
                  name: part.fileData.fileUri?.split('/').pop() || 'file'
                }
              }) + '\n');
              return true;
            }
            return false;
          }
          
          // Check for imageData (alternative structure)
          if (part.imageData) {
            const imageData = part.imageData.data || part.imageData.base64 || part.imageData;
            const imageKey = getImageKey(imageData);
            if (!sentImages.has(imageKey)) {
              sentImages.add(imageKey);
              res.write(JSON.stringify({
                image: {
                  data: imageData,
                  mimeType: part.imageData.mimeType || part.imageData.mime_type || 'image/png'
                }
              }) + '\n');
              return true;
            }
            return false;
          }
          
          return false;
        };
        
        // Check chunk.parts (direct parts)
        if (chunk?.parts && Array.isArray(chunk.parts)) {
          for (const part of chunk.parts) {
            processPart(part);
          }
        }
        
        // Check chunk.response.candidates[].content.parts (nested structure)
        if (chunk?.response?.candidates) {
          for (const candidate of chunk.response.candidates) {
            if (candidate.content?.parts) {
              for (const part of candidate.content.parts) {
                processPart(part);
              }
            }
            // Also check candidate.content directly
            if (candidate.content && !candidate.content.parts) {
              processPart(candidate.content);
            }
          }
        }
        
        // Check for direct candidates array
        if (chunk?.candidates && Array.isArray(chunk.candidates)) {
          for (const candidate of chunk.candidates) {
            if (candidate.content?.parts) {
              for (const part of candidate.content.parts) {
                processPart(part);
              }
            }
            // Also check candidate.content directly
            if (candidate.content && !candidate.content.parts) {
              processPart(candidate.content);
            }
          }
        }
        
        // Check for any other nested structures that might contain parts
        if (chunk?.content?.parts) {
          for (const part of chunk.content.parts) {
            processPart(part);
          }
        }
        
        // Check if chunk itself is a part
        if (chunk.inlineData || chunk.fileData || chunk.imageData) {
          processPart(chunk);
        }
      }
      
      // After streaming, check the last chunk more thoroughly for image data
      // Some models return image data only in the final chunk
      if (allChunks.length > 0) {
        const lastChunk = allChunks[allChunks.length - 1];
        console.log('Final chunk structure check for images...');
        
        // Deep search for image data in the final chunk (with deduplication)
        const searchForImages = (obj, path = '') => {
          if (!obj || typeof obj !== 'object') return;
          
          if (obj.inlineData) {
            const imageKey = getImageKey(obj.inlineData.data);
            if (!sentImages.has(imageKey)) {
              console.log(`Found inlineData at path: ${path}`);
              sentImages.add(imageKey);
              res.write(JSON.stringify({
                image: {
                  data: obj.inlineData.data,
                  mimeType: obj.inlineData.mimeType || 'image/png'
                }
              }) + '\n');
            }
          }
          
          if (obj.imageData) {
            const imageData = obj.imageData.data || obj.imageData.base64 || obj.imageData;
            const imageKey = getImageKey(imageData);
            if (!sentImages.has(imageKey)) {
              console.log(`Found imageData at path: ${path}`);
              sentImages.add(imageKey);
              res.write(JSON.stringify({
                image: {
                  data: imageData,
                  mimeType: obj.imageData.mimeType || obj.imageData.mime_type || 'image/png'
                }
              }) + '\n');
            }
          }
          
          // Recursively search nested objects (limit depth to avoid infinite loops)
          if (path.split('.').length < 5) {
            for (const key in obj) {
              if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
                searchForImages(obj[key], path ? `${path}.${key}` : key);
              }
            }
          }
        };
        
        searchForImages(lastChunk);
      }
      res.write(JSON.stringify({ done: true }) + '\n');
      return res.end();
    }

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration: OPENAI_API_KEY not set' });

      // Map messages to OpenAI format and include system prompt
      const files = Array.isArray(req.files) ? req.files : [];
      const oaMessages = [];
      oaMessages.push({ role: 'system', content: agent.masterPrompt });

      for (const msg of messages) {
        const role = msg.role === 'model' ? 'assistant' : 'user';
        oaMessages.push({ role, content: msg.content });
      }

      // Merge uploaded files into the last user message as base64
      if (files.length > 0) {
        let lastUserIdx = -1;
        for (let i = oaMessages.length - 1; i >= 0; i--) {
          if (oaMessages[i].role === 'user') { lastUserIdx = i; break; }
        }

        const contentParts = [];
        // Add existing text content
        if (lastUserIdx >= 0 && oaMessages[lastUserIdx].content) {
          contentParts.push({
            type: 'input_text',
            text: oaMessages[lastUserIdx].content
          });
        }

        // Add file attachments as base64
        for (const f of files) {
          if (f.mimetype.startsWith('image/')) {
            contentParts.push({
              type: 'input_image',
              image_url: `data:${f.mimetype};base64,${Buffer.from(f.buffer).toString('base64')}`,
            });
          } else {
            contentParts.push({
              type: 'input_file',
              filename: f.originalname,
              file_data: `data:${f.mimetype};base64,${Buffer.from(f.buffer).toString('base64')}`,
            });
          }
        }

        if (lastUserIdx >= 0) {
          oaMessages[lastUserIdx].content = contentParts;
        } else {
          oaMessages.push({ role: 'user', content: contentParts });
        }
      }

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          input: oaMessages,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        return res.status(500).json({ error: `OpenAI error: ${errText || response.status}` });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (abortController.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') {
            res.write(JSON.stringify({ done: true }) + '\n');
            return res.end();
          }
          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'response.output_text.delta': {
                // Stream incremental text chunks
                const t = event.delta || '';
                if (t) {
                  res.write(JSON.stringify({ text: t }) + '\n');
                }
                break;
              }
              case 'response.output_text.done': {
                // Contains the full text if you want it
                // const full = event.output_text?.text;
                // Optional: you can emit it or ignore if you already streamed deltas
                break;
              }
              case 'response.output_item.added': {
                // Handle image or file outputs
                const item = event.item;
                if (item?.type === 'image') {
                  const imageData = item.image_data || item.image;
                  if (imageData) {
                    res.write(JSON.stringify({
                      image: {
                        data: imageData.data || imageData.b64_json || imageData.url,
                        mimeType: imageData.mime_type || imageData.mimeType || 'image/png'
                      }
                    }) + '\n');
                  }
                } else if (item?.type === 'file') {
                  const fileData = item.file_data || item.file;
                  if (fileData) {
                    res.write(JSON.stringify({
                      file: {
                        data: fileData.data || fileData.b64_json || fileData.url,
                        mimeType: fileData.mime_type || fileData.mimeType || 'application/octet-stream',
                        name: fileData.name || fileData.filename || 'file'
                      }
                    }) + '\n');
                  }
                }
                break;
              }
              case 'response.completed': {
                // Overall response finished
                res.write(JSON.stringify({ done: true }) + '\n');
                return res.end();
              }
              case 'error': {
                res.write(JSON.stringify({ text: event.error.message }) + '\n');
                res.write(JSON.stringify({ done: true }) + '\n');
                return res.end();
              }
              default: {
                // Other event types (tool calls, reasoning, etc.) can be handled as needed
                break;
              }
            }
          } catch {}
        }
      }
      res.write(JSON.stringify({ done: true }) + '\n');
      return res.end();
    }

    // Anthropic
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration: ANTHROPIC_API_KEY not set' });

    // Map to Anthropic messages and merge attachments (images supported)
    const files = Array.isArray(req.files) ? req.files : [];
    const anthropicMessages = [];
    for (const msg of messages) {
      const content = [];
      if (msg.content && msg.content.length) content.push({ type: 'text', text: msg.content });
      if (msg.role === 'user') {
        // Attach files only to the last user message later
        anthropicMessages.push({ role: 'user', content });
      } else {
        anthropicMessages.push({ role: 'assistant', content });
      }
    }
    if (files.length > 0) {
      // Find last user message
      let lastUserIdx = -1;
      for (let i = anthropicMessages.length - 1; i >= 0; i--) {
        if (anthropicMessages[i].role === 'user') { lastUserIdx = i; break; }
      }
      const imageBlocks = [];
      const unsupportedNotes = [];
      for (const f of files) {
        if (f.mimetype && f.mimetype.startsWith('image/')) {
          imageBlocks.push({
            type: 'input_image',
            source: {
              type: 'base64',
              media_type: f.mimetype,
              data: Buffer.from(f.buffer).toString('base64'),
            }
          });
        } else {
          unsupportedNotes.push(`${f.originalname} (${f.mimetype || 'application/octet-stream'})`);
        }
      }
      if (lastUserIdx >= 0) {
        anthropicMessages[lastUserIdx].content = [
          ...anthropicMessages[lastUserIdx].content,
          ...imageBlocks,
          ...(unsupportedNotes.length ? [{ type: 'text', text: `Attached files not supported by Anthropic in this mode: ${unsupportedNotes.join(', ')}` }] : []),
        ];
      } else if (imageBlocks.length || unsupportedNotes.length) {
        anthropicMessages.push({ role: 'user', content: [
          ...imageBlocks,
          ...(unsupportedNotes.length ? [{ type: 'text', text: `Attached files not supported by Anthropic in this mode: ${unsupportedNotes.join(', ')}` }] : []),
        ]});
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        system: agent.masterPrompt,
        messages: anthropicMessages,
        max_tokens: 1024,
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      return res.status(500).json({ error: `Anthropic error: ${errText || response.status}` });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      if (abortController.signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim(); 
          if (data === '[DONE]') {
            res.write(JSON.stringify({ done: true }) + '\n');
            return res.end();
          }
          try {
            const json = JSON.parse(data);
            // Handle text content
            const t = json?.delta?.text || json?.message?.content?.[0]?.text || '';
            if (t) res.write(JSON.stringify({ text: t }) + '\n');
            
            // Handle image content blocks
            if (json?.type === 'content_block_start' && json?.content_block?.type === 'image') {
              const imageBlock = json.content_block;
              if (imageBlock.source?.type === 'base64') {
                res.write(JSON.stringify({
                  image: {
                    data: imageBlock.source.data,
                    mimeType: imageBlock.source.media_type || 'image/png'
                  }
                }) + '\n');
              }
            }
            
            // Handle complete content blocks with images
            if (json?.type === 'content_block_delta' && json?.delta?.type === 'image_delta') {
              const imageDelta = json.delta;
              if (imageDelta.source?.type === 'base64') {
                res.write(JSON.stringify({
                  image: {
                    data: imageDelta.source.data,
                    mimeType: imageDelta.source.media_type || 'image/png'
                  }
                }) + '\n');
              }
            }
          } catch {}
        }
      }
    }
    res.write(JSON.stringify({ done: true }) + '\n');
    return res.end();
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('Stream aborted by client');
      try { res.end(); } catch {}
      return;
    }
    console.error('Streaming error:', e);
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to stream response' });
    try { res.end(); } catch {}
  }
});

app.listen(PORT, async () => {
  await initDb();
  console.log(`API server listening on http://localhost:${PORT}`);
});
