
export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
  alt?: string;
}

export interface FileContent {
  type: 'file';
  data: string; // base64 encoded
  mimeType: string;
  name: string;
  size?: number;
}

export interface VideoContent {
  type: 'video';
  data: string; // video URL or base64 encoded
  mimeType: string;
  name?: string;
}

export interface Message {
  role: 'user' | 'model';
  content: string; // text content
  attachments?: AttachmentMeta[]; // for user-uploaded files
  images?: ImageContent[]; // for AI-generated or referenced images
  files?: FileContent[]; // for AI-generated or referenced files
  videos?: VideoContent[]; // for AI-generated videos
}

export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: number;
  // A preview of the first user message for display
  title: string;
}

export interface Role {
  id: string;
  name: string;
}

export interface Agent {
  id: string;
  name: string;
  masterPrompt: string;
  model: string;
  createdAt: number;
  roleId: string;
  roleName?: string;
}

export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roleIds: string[];
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  roleIds?: string[];
}
