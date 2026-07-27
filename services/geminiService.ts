
import type { Agent, Message } from '../types';
import { getToken } from './api';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:4000';

// Sanitize messages by removing large base64 image data to reduce payload size
// Keep only metadata/references for images that were generated
const sanitizeMessagesForAPI = (messages: Message[]): Message[] => {
  return messages.map(msg => {
    const sanitized: Message = {
      role: msg.role,
      content: msg.content,
    };
    
    // Keep attachment metadata (small, just file info)
    if (msg.attachments) {
      sanitized.attachments = msg.attachments;
    }
    
    // For images/files/videos, replace large base64 data with a reference
    // This keeps the conversation context but reduces payload size dramatically
    if (msg.images && msg.images.length > 0) {
      sanitized.images = msg.images.map((img, idx) => ({
        type: 'image' as const,
        data: `[Image ${idx + 1}: ${img.mimeType}]`, // Replace large base64 with reference
        mimeType: img.mimeType,
        alt: img.alt
      }));
    }
    
    if (msg.files && msg.files.length > 0) {
      sanitized.files = msg.files.map((file, idx) => ({
        type: 'file' as const,
        data: `[File ${idx + 1}: ${file.name}]`, // Replace large base64 with reference
        mimeType: file.mimeType,
        name: file.name,
        size: file.size
      }));
    }

    if (msg.videos && msg.videos.length > 0) {
      sanitized.videos = msg.videos.map((video, idx) => ({
        type: 'video' as const,
        data: `[Video ${idx + 1}: ${video.mimeType}]`, // Replace large base64 with reference
        mimeType: video.mimeType,
        name: video.name
      }));
    }
    
    return sanitized;
  });
};

// Calls backend streaming endpoint and returns an async iterator of { text }
export const streamChatResponse = async (agent: Agent, messages: Message[], files?: File[], signal?: AbortSignal) => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Accept': 'application/x-ndjson',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Sanitize messages to remove large base64 data before sending
  const sanitizedMessages = sanitizeMessagesForAPI(messages);

  let res: Response;
  if (files && files.length > 0) {
    const fd = new FormData();
    fd.append('agent', JSON.stringify(agent));
    fd.append('messages', JSON.stringify(sanitizedMessages));
    for (const f of files) fd.append('files', f);
    res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: fd,
      signal,
    });
  } else {
    headers['Content-Type'] = 'application/json';
    res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agent, messages: sanitizedMessages }),
      signal,
    });
  }

  if (!res.ok) {
    if (res.status === 401) {
      try { window.dispatchEvent(new Event('unauthorized')); } catch {}
      throw new Error('Unauthorized');
    }
    let errText = await res.text().catch(() => '');
    try { const j = JSON.parse(errText); errText = j.error || errText; } catch {}
    throw new Error(errText || `HTTP ${res.status}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  async function* iterate() {
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.done) return;
            if (typeof obj.text === 'string' && obj.text.length) {
              yield { text: obj.text } as any;
            }
            if (obj.image) {
              yield { image: obj.image } as any;
            }
            if (obj.file) {
              yield { file: obj.file } as any;
            }
            if (obj.video) {
              yield { video: obj.video } as any;
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  return iterate();
};