
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import type { Agent, Conversation, Message } from '../types';
import { streamChatResponse } from '../services/geminiService';
// FIX: Imported missing ChatBubbleIcon
import {
  ArrowLeftIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  UserIcon,
  ChatBubbleIcon,
  PaperClipIcon,
  TrashIcon,
  EditIcon,
  EllipsisVerticalIcon
} from './Icons';
import Markdown from './Markdown';

interface ChatViewProps {
  agent: Agent;
  conversations: Conversation[];
  onBack: () => void;
  updateConversations: (agentId: string, conversations: Conversation[]) => void;
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}

const ChatView: React.FC<ChatViewProps> = ({ agent, conversations, onBack, updateConversations }) => {
  // Initialize activeConversationId from sessionStorage to persist across remounts
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(`chat_activeConversationId_${agent.id}`);
      // Verify the stored conversation still exists
      if (stored && conversations.find(c => c.id === stored)) {
        return stored;
      }
    }
    return null;
  });
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  // Local state for streaming conversation to avoid parent re-renders
  const [localActiveConversation, setLocalActiveConversation] = useState<Conversation | null>(null);
  // State to track if we're currently streaming (use state so it triggers re-renders correctly)
  const [isStreaming, setIsStreaming] = useState(false);
  // Ref to track streaming for useEffect checks (ref doesn't trigger re-renders)
  const isStreamingRef = useRef(false);
  const seenImageKeysRef = useRef<Set<string>>(new Set());
  const loadedImageKeysRef = useRef<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const autoCreatedOnTypeRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollToBottomThrottledRef = useRef<number | null>(null);
  // Track if initial conversation selection has been done to prevent unwanted auto-selection
  const hasInitialSelectionRef = useRef(false);

  // Ref to store AbortController for stopping stream
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };
  // Store the last active conversation ID to restore after potential re-renders
  const lastActiveConversationIdRef = useRef<string | null>(null);
  const isGptModel = agent.model.startsWith('gpt');
  const isGptModelWithFileSupport = agent.model.startsWith('gpt') && (agent.model == 'gpt-4' || agent.model == 'gpt-4o');
  let attachmentHelperText = "";
  if (isGptModelWithFileSupport) {
    attachmentHelperText = "PDFs and images are supported for OpenAI models";
  } else if (isGptModel) {
    attachmentHelperText = "Files are only supported in GPT-4 models"
  } else {
    attachmentHelperText = "Attach files";
  }

  // Use local state during streaming to avoid parent re-renders, otherwise use conversations prop
  // Always prefer local state when loading or streaming
  const activeConversation = (() => {
    // During loading or streaming, always use local state if it exists and matches
    if ((isLoading || isStreaming) && localActiveConversation && localActiveConversation.id === activeConversationId) {
      return localActiveConversation;
    }
    // Otherwise, prefer local state if it matches, else use conversations prop
    if (localActiveConversation && localActiveConversation.id === activeConversationId) {
      return localActiveConversation;
    }
    return conversations.find(c => c.id === activeConversationId) || null;
  })();
  
  // Sync local state when activeConversationId changes or conversations prop updates (when not streaming)
  // During streaming, we use local state to avoid parent re-renders - don't sync during streaming
  useEffect(() => {
    // CRITICAL: Only sync when not loading AND not streaming to avoid interfering with streaming updates
    // Check both state and ref to be absolutely sure
    if (!isLoading && !isStreaming && !isStreamingRef.current) {
      if (activeConversationId) {
        const conv = conversations.find(c => c.id === activeConversationId);
        // Only update if different to avoid unnecessary re-renders
        if (conv) {
          const currentLocal = localActiveConversation;
          if (!currentLocal || currentLocal.id !== conv.id || 
              JSON.stringify(currentLocal.messages) !== JSON.stringify(conv.messages)) {
            setLocalActiveConversation(conv);
          }
        } else {
          setLocalActiveConversation(null);
        }
      } else {
        setLocalActiveConversation(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversations, isLoading, isStreaming]);
  

  const scrollToBottom = useCallback((force = false) => {
    const container = chatContainerRef.current;
    if (!container) return;
    
    // Check if user is near bottom (within 100px) or force scroll
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    
    if (force || isNearBottom || shouldAutoScrollRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (container) {
          // Use instant scroll for better performance during streaming
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, []);

  // Throttled scroll for streaming updates
  const scrollToBottomThrottled = useCallback(() => {
    if (scrollToBottomThrottledRef.current !== null) return;
    
    scrollToBottomThrottledRef.current = window.setTimeout(() => {
      scrollToBottom();
      scrollToBottomThrottledRef.current = null;
    }, 50); // Throttle to max once per 50ms
  }, [scrollToBottom]);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset height to recalculate correctly
    el.style.height = 'auto';
    const max = 160; // Tailwind max-h-40 (10rem)
    const newHeight = Math.min(el.scrollHeight, max);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, []);

  // Update the ref and sessionStorage whenever activeConversationId changes
  useEffect(() => {
    if (activeConversationId) {
      lastActiveConversationIdRef.current = activeConversationId;
      hasInitialSelectionRef.current = true;
      // Persist to sessionStorage to survive component remounts
      sessionStorage.setItem(`chat_activeConversationId_${agent.id}`, activeConversationId);
    }
  }, [activeConversationId, agent.id]);

  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      // First, check sessionStorage for persisted conversation ID (survives remounts)
      const storedId = sessionStorage.getItem(`chat_activeConversationId_${agent.id}`);
      if (storedId) {
        const storedConv = conversations.find(c => c.id === storedId);
        if (storedConv) {
          // Restore from sessionStorage
          setActiveConversationId(storedId);
          hasInitialSelectionRef.current = true;
          return;
        }
      }
      
      // Then check ref (for re-renders within same mount)
      if (lastActiveConversationIdRef.current) {
        const lastConv = conversations.find(c => c.id === lastActiveConversationIdRef.current);
        if (lastConv) {
          // Restore the previous selection
          setActiveConversationId(lastActiveConversationIdRef.current);
          return;
        }
      }
      
      // Only auto-select if we haven't made an initial selection yet
      // This prevents auto-selecting the first conversation after streaming completes
      if (!hasInitialSelectionRef.current) {
        const sortedConversations = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
        setActiveConversationId(sortedConversations[0].id);
      }
    }
  }, [conversations, activeConversationId, agent.id]);

  // Track manual scrolling to prevent auto-scroll when user scrolls up
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      shouldAutoScrollRef.current = isAtBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollToBottomThrottledRef.current !== null) {
        clearTimeout(scrollToBottomThrottledRef.current);
      }
    };
  }, []);

  // Scroll to bottom when messages change, but only if user is near bottom
  useEffect(() => {
    // Use throttled scroll during streaming, instant scroll otherwise
    if (isLoading) {
      scrollToBottomThrottled();
    } else {
      // Use a small delay to ensure DOM is updated
      const timeoutId = setTimeout(() => {
        scrollToBottom();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [activeConversation?.messages, isLoading, scrollToBottom, scrollToBottomThrottled]);

  // Mark new images as loading when they first appear
  useEffect(() => {
    if (!activeConversation) return;
    
    const newLoadingImages = new Set<string>();
    activeConversation.messages.forEach((msg, msgIndex) => {
      if (msg.images && msg.images.length > 0) {
        msg.images.forEach((img, imgIndex) => {
          const imageDataKey = img.data.substring(0, 100);
          const imageKey = `${activeConversationId}-${msgIndex}-${imgIndex}`;
          
          // Only mark as loading if we haven't seen this image data before
          // AND it hasn't already been loaded
          if (!seenImageKeysRef.current.has(imageDataKey) && !loadedImageKeysRef.current.has(imageKey)) {
            seenImageKeysRef.current.add(imageDataKey);
            newLoadingImages.add(imageKey);
          }
        });
      }
    });
    
    if (newLoadingImages.size > 0) {
      setLoadingImages(prev => {
        const next = new Set(prev);
        newLoadingImages.forEach(key => {
          // Only add if not already loaded
          if (!loadedImageKeysRef.current.has(key)) {
            next.add(key);
          }
        });
        return next;
      });
    }
  }, [activeConversation?.messages, activeConversationId]);

  // Adjust textarea height when the message content changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [currentMessage, adjustTextareaHeight]);

  // Reset the auto-create guard whenever an active conversation is set/changed
  useEffect(() => {
    if (activeConversationId) {
      autoCreatedOnTypeRef.current = false;
    }
  }, [activeConversationId]);

  // Auto-focus input field when streaming/loading ends (survives remounts via sessionStorage)
  useEffect(() => {
    const storageKey = `chat_shouldFocusInput_${agent.id}`;
    
    if (isLoading || isStreaming) {
      // Mark that we're streaming, so we know to focus after it ends
      sessionStorage.setItem(storageKey, 'true');
    } else {
      // Check if we should focus (streaming just ended, possibly after remount)
      const shouldFocus = sessionStorage.getItem(storageKey) === 'true';
      if (shouldFocus) {
        sessionStorage.removeItem(storageKey);
        // Small delay to ensure DOM is fully updated
        const timeoutId = setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isLoading, isStreaming, agent.id]);

  const handleNewConversation = () => {
    const newConversation: Conversation = {
      id: Date.now().toString(),
      messages: [],
      createdAt: Date.now(),
      title: "New Chat",
    };
    const updatedConversations = [newConversation, ...conversations];
    updateConversations(agent.id, updatedConversations);
    setActiveConversationId(newConversation.id);
  };

  const handleSendMessage = async () => {
    if (!activeConversation || (!currentMessage.trim() && attachedFiles.length === 0)) return;

    const initialText = currentMessage.trim().length ? currentMessage : (attachedFiles.length ? `(Sent ${attachedFiles.length} file${attachedFiles.length>1?'s':''})` : '');
    const attachmentMetas = attachedFiles.length
      ? attachedFiles.map(f => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' }))
      : undefined;
    const userMessage: Message = attachmentMetas
      ? { role: 'user', content: initialText, attachments: attachmentMetas }
      : { role: 'user', content: initialText };
    const updatedMessages = [...activeConversation.messages, userMessage];

    // Update conversation title if it's the first message
    let updatedTitle = activeConversation.title;
    if (activeConversation.messages.length === 0) {
        const base = currentMessage.trim().length ? currentMessage : (attachedFiles.length ? `(Sent ${attachedFiles.length} file${attachedFiles.length>1?'s':''})` : '');
        updatedTitle = base.substring(0, 30) + (base.length > 30 ? '...' : '');
    }

    const updatedActiveConversation = { ...activeConversation, messages: updatedMessages, title: updatedTitle };

    // CRITICAL: Use flushSync to ensure all state updates happen synchronously and immediately
    // This ensures the loading indicator and user message show immediately
    // DO NOT update parent state here - it causes re-renders that reset our local state
    // Create a completely new object to ensure React detects the change
    const newLocalConv: Conversation = {
      id: updatedActiveConversation.id,
      title: updatedActiveConversation.title,
      createdAt: updatedActiveConversation.createdAt,
      messages: [...updatedActiveConversation.messages] // New array reference
    };
    
    flushSync(() => {
      // Set loading and streaming flags FIRST
      setIsLoading(true);
      setIsStreaming(true);
      isStreamingRef.current = true;
      
      // Update local state immediately for smooth UI (this will be used during streaming)
      setLocalActiveConversation(newLocalConv);
    });
    
    // Clear input fields
    setCurrentMessage('');
    const filesToSend = attachedFiles.slice();
    setAttachedFiles([]);
    
    // DO NOT update parent state here - wait until streaming completes
    // This prevents parent re-renders that interfere with local state
    
    // Force scroll after adding user message
    shouldAutoScrollRef.current = true;
    setTimeout(() => scrollToBottom(true), 0);

    // Create an AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      const stream = await streamChatResponse(agent, updatedMessages, filesToSend, abortControllerRef.current.signal);
      
      // Track seen images/files/videos to avoid duplicates
      const seenImageKeys = new Set<string>();
      const seenFileKeys = new Set<string>();
      const seenVideoKeys = new Set<string>();
      
      const getImageKey = (data: string) => {
        // Use first 100 chars as key for deduplication
        return data.substring(0, 100);
      };
      
      // Initialize with empty model message
      let modelResponse = '';
      const modelImages: Array<{ data: string; mimeType: string }> = [];
      const modelFiles: Array<{ data: string; mimeType: string; name: string }> = [];
      const modelVideos: Array<{ data: string; mimeType: string; name?: string }> = [];
      const modelMessage: Message = { role: 'model', content: '' };
      const initialMessages = [...updatedMessages, modelMessage];
      let currentConv: Conversation = { 
        ...updatedActiveConversation, 
        messages: initialMessages
      };
      
      // Show initial empty model message immediately
      flushSync(() => {
        setLocalActiveConversation(currentConv);
      });
      
      for await (const chunk of stream) {
        if (chunk.text) {
          modelResponse += chunk.text;
        }
        if (chunk.image) {
          const imageKey = getImageKey(chunk.image.data);
          if (!seenImageKeys.has(imageKey)) {
            seenImageKeys.add(imageKey);
            modelImages.push({
              data: chunk.image.data,
              mimeType: chunk.image.mimeType
            });
          }
        }
        if (chunk.file) {
          const fileKey = chunk.file.data;
          if (!seenFileKeys.has(fileKey)) {
            seenFileKeys.add(fileKey);
            modelFiles.push({
              data: chunk.file.data,
              mimeType: chunk.file.mimeType,
              name: chunk.file.name || 'file'
            });
          }
        }
        if (chunk.video) {
          const videoKey = chunk.video.data;
          if (!seenVideoKeys.has(videoKey)) {
            seenVideoKeys.add(videoKey);
            modelVideos.push({
              data: chunk.video.data,
              mimeType: chunk.video.mimeType || 'video/mp4',
              name: chunk.video.name || 'generated-video.mp4'
            });
          }
        }
        
        // Create updated model message with current content
        const currentModelMessage: Message = {
          role: 'model',
          content: modelResponse,
          images: modelImages.length > 0 ? modelImages.map(img => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType
          })) : undefined,
          files: modelFiles.length > 0 ? modelFiles.map(f => ({
            type: 'file' as const,
            data: f.data,
            mimeType: f.mimeType,
            name: f.name
          })) : undefined,
          videos: modelVideos.length > 0 ? modelVideos.map(v => ({
            type: 'video' as const,
            data: v.data,
            mimeType: v.mimeType,
            name: v.name
          })) : undefined
        };
        
        // Create new conversation object with updated messages (new reference to trigger re-render)
        const streamingMessages = [...updatedMessages, currentModelMessage];
        // Create a completely new object to ensure React detects the change
        const newConv: Conversation = { 
          id: updatedActiveConversation.id,
          title: updatedActiveConversation.title,
          createdAt: updatedActiveConversation.createdAt,
          messages: [...streamingMessages] // New array reference
        };
        currentConv = newConv;
        
        // Update local state immediately with flushSync for real-time streaming
        // This forces React to apply the update synchronously and re-render immediately
        flushSync(() => {
          setLocalActiveConversation(newConv);
        });
      }
      
      // Final sync with parent state after streaming completes (only once at the end)
      const finalConvs = conversations.map(c => c.id === activeConversationId ? currentConv : c);
      updateConversations(agent.id, finalConvs);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Stream aborted by user');
        // Final sync with parent state after streaming is aborted
        const finalConvs = conversations.map(c => c.id === activeConversationId ? currentConv : c);
        updateConversations(agent.id, finalConvs);
      } else {
        console.error("Error streaming response:", error);
        const errorText = error?.message || "Sorry, I couldn't get a response. Please check your API key and try again.";
        const errorMessage: Message = { role: 'model', content: errorText };
        const errorMessages = [...updatedMessages, errorMessage];
        const errorConv = { ...updatedActiveConversation, messages: errorMessages };
        // Update local state
        setLocalActiveConversation(errorConv);
        // Final sync with parent
        const errorConvs = conversations.map(c => c.id === activeConversationId ? errorConv : c);
        updateConversations(agent.id, errorConvs);
      }
    } finally {
      // Reset streaming flags and loading state
      isStreamingRef.current = false;
      setIsStreaming(false);
      setIsLoading(false);
      // Local state will be synced by useEffect when conversations prop updates
      // Auto-focus is handled by the useEffect that watches isLoading/isStreaming
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-brand-surface">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center gap-4 p-4 bg-brand-bg border-b border-brand-surface-light">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-brand-surface-light transition-colors">
          <ArrowLeftIcon className="w-5 h-5"/>
        </button>
        <h2 className="text-lg font-semibold truncate flex-grow">{agent.name}</h2>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-full hover:bg-brand-surface-light transition-colors">
          <ChatBubbleIcon className="w-5 h-5"/>
        </button>
      </div>

      {/* Sidebar */}
      <div
          className={`fixed inset-0 z-20 transform md:relative md:transform-none md:w-1/5 bg-brand-bg md:flex flex-col border-r border-brand-surface-light transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="hidden md:flex items-center gap-4 my-3 flex-shrink-0">
          <button onClick={onBack} className="p-2 rounded-full hover:bg-brand-surface-light transition-colors">
            <ArrowLeftIcon className="w-5 h-5"/>
          </button>
          <h2 className="text-lg font-semibold truncate pr-4">{agent.name}</h2>
        </div>
        <div className="md:hidden flex items-center p-4">
          <button onClick={() => setIsMobileMenuOpen(false)}
                  className="p-2 rounded-full hover:bg-brand-surface-light transition-colors">
            <ArrowLeftIcon className="w-5 h-5"/>
          </button>
          <h2 className="text-lg pl-2 font-semibold truncate">Conversations</h2>

        </div>
        <button onClick={handleNewConversation} className="flex items-center justify-center gap-2 w-full px-4 py-2 mb-4 bg-brand-surface-light rounded-md hover:bg-opacity-80 transition-colors">
          <PlusIcon className="w-5 h-5" />
          New Chat
        </button>
        <div className="overflow-y-auto flex-grow">
          {[...conversations].sort((a,b) => b.createdAt - a.createdAt).map(conv => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={activeConversationId === conv.id}
              onSelect={() => setActiveConversationId(conv.id)}
              onRename={(newTitle) => {
                const updatedConvs = conversations.map(c =>
                  c.id === conv.id ? {...c, title: newTitle} : c
                );
                updateConversations(agent.id, updatedConvs);
              }}
              onDelete={() => {
                const updatedConvs = conversations.filter(c => c.id !== conv.id);
                updateConversations(agent.id, updatedConvs);
                if (activeConversationId === conv.id) {
                  // Clear the stored ref and sessionStorage since this conversation is being deleted
                  const newActiveId = updatedConvs[0]?.id || null;
                  lastActiveConversationIdRef.current = newActiveId;
                  if (newActiveId) {
                    sessionStorage.setItem(`chat_activeConversationId_${agent.id}`, newActiveId);
                  } else {
                    sessionStorage.removeItem(`chat_activeConversationId_${agent.id}`);
                  }
                  setActiveConversationId(newActiveId);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
          <div
              className="fixed inset-0 bg-black/50 z-10 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
          />
      )}

      {/* Main Chat Area */}
      <div className="flex-grow flex flex-col h-[calc(100vh-64px)] md:h-full">
        <div ref={chatContainerRef} className="flex-grow overflow-y-auto p-4 md:p-6">
          {activeConversation ? (
            <div>
              {activeConversation.messages.map((msg, index) => (
                <div key={index} className={`flex gap-4 mb-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'model' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-secondary flex items-center justify-center"><SparklesIcon className="w-5 h-5 text-brand-bg"/></div>}
                  <div className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-brand-primary text-brand-bg rounded-br-none' : 'bg-brand-surface-light rounded-bl-none'}`}>
                    {msg.content && <Markdown content={msg.content} />}
                    {msg.images && msg.images.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        {msg.images.map((img, i) => {
                          const isUrl = img.data.startsWith('http://') || img.data.startsWith('https://');
                          const src = isUrl ? img.data : `data:${img.mimeType};base64,${img.data}`;
                          const imageKey = `${activeConversationId}-${index}-${i}`;
                          const isAlreadyLoaded = loadedImageKeysRef.current.has(imageKey);
                          const isLoading = loadingImages.has(imageKey) && !isAlreadyLoaded;
                          
                          return (
                            <div key={i} className="rounded-lg overflow-hidden relative">
                              {isLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-brand-surface-light animate-pulse">
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
                                    <span className="text-xs text-brand-text-light">Loading image...</span>
                                  </div>
                                </div>
                              )}
                              <img
                                ref={(imgElement) => {
                                  // Check if image is already complete (for base64 images that load instantly)
                                  if (imgElement && imgElement.complete && !loadedImageKeysRef.current.has(imageKey)) {
                                    loadedImageKeysRef.current.add(imageKey);
                                    setLoadingImages(prev => {
                                      const next = new Set(prev);
                                      next.delete(imageKey);
                                      return next;
                                    });
                                  }
                                }}
                                src={src}
                                alt={img.alt || `Image ${i + 1}`}
                                className={`max-w-full h-auto ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                                style={{ maxHeight: '400px' }}
                                onLoad={() => {
                                  if (!loadedImageKeysRef.current.has(imageKey)) {
                                    loadedImageKeysRef.current.add(imageKey);
                                    setLoadingImages(prev => {
                                      const next = new Set(prev);
                                      next.delete(imageKey);
                                      return next;
                                    });
                                  }
                                }}
                                onError={() => {
                                  if (!loadedImageKeysRef.current.has(imageKey)) {
                                    loadedImageKeysRef.current.add(imageKey);
                                    setLoadingImages(prev => {
                                      const next = new Set(prev);
                                      next.delete(imageKey);
                                      return next;
                                    });
                                  }
                                }}
                                onLoadStart={() => {
                                  if (!loadedImageKeysRef.current.has(imageKey)) {
                                    setLoadingImages(prev => new Set(prev).add(imageKey));
                                  }
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.files && msg.files.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {msg.files.map((file, i) => {
                          const isUrl = file.data.startsWith('http://') || file.data.startsWith('https://');
                          const href = isUrl ? file.data : `data:${file.mimeType};base64,${file.data}`;
                          return (
                            <a
                              key={i}
                              href={href}
                              download={isUrl ? undefined : file.name}
                              target={isUrl ? '_blank' : undefined}
                              rel={isUrl ? 'noopener noreferrer' : undefined}
                              className={`inline-flex items-center gap-2 px-2 py-1 rounded text-sm ${msg.role === 'user' ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'} transition-colors`}
                              title={`${file.name}${file.size ? ` (${(file.size/1024/1024).toFixed(2)} MB)` : ''}`}
                            >
                              <PaperClipIcon className="w-4 h-4 opacity-70" />
                              <span className="truncate max-w-[200px]">{file.name}</span>
                              {file.size && <span className="opacity-60">· {(file.size/1024/1024).toFixed(2)} MB</span>}
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {msg.videos && msg.videos.length > 0 && (
                      <div className="mt-3 flex flex-col gap-3">
                        {msg.videos.map((video, i) => {
                          const isUrl = video.data.startsWith('http://') || video.data.startsWith('https://');
                          const src = isUrl ? video.data : `data:${video.mimeType};base64,${video.data}`;
                          return (
                            <div key={i} className="rounded-lg overflow-hidden bg-black/5">
                              <video
                                controls
                                className="max-w-full h-auto"
                                style={{ maxHeight: '500px' }}
                                preload="metadata"
                              >
                                <source src={src} type={video.mimeType} />
                                Your browser does not support the video tag.
                              </video>
                              {video.name && (
                                <div className="px-2 py-1 text-xs text-brand-text-light truncate">
                                  {video.name}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {msg.attachments.map((att, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-2 px-2 py-1 rounded text-sm ${msg.role === 'user' ? 'bg-white/10' : 'bg-black/5'}`}
                            title={`${att.name} (${(att.size/1024/1024).toFixed(2)} MB)`}
                          >
                            <PaperClipIcon className="w-4 h-4 opacity-70" />
                            <span className="truncate max-w-[200px]">{att.name}</span>
                            <span className="opacity-60">· {(att.size/1024/1024).toFixed(2)} MB</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                   {msg.role === 'user' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-surface-light flex items-center justify-center"><UserIcon className="w-5 h-5 text-brand-text-light"/></div>}
                </div>
              ))}
              {(isLoading || isStreaming) && (
                 <div className="flex gap-4 mb-6 justify-start">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-secondary flex items-center justify-center"><SparklesIcon className="w-5 h-5 text-brand-bg"/></div>
                    <div className="max-w-xl p-4 rounded-2xl bg-brand-surface-light rounded-bl-none flex items-center">
                        <div className="w-2 h-2 bg-brand-text-light rounded-full animate-pulse mx-1"></div>
                        <div className="w-2 h-2 bg-brand-text-light rounded-full animate-pulse mx-1 delay-150"></div>
                        <div className="w-2 h-2 bg-brand-text-light rounded-full animate-pulse mx-1 delay-300"></div>
                    </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-brand-text-light">
                <ChatBubbleIcon className="w-16 h-16 mb-4"/>
                <p>Select a conversation or start a new one.</p>
            </div>
          )}
        </div>
        <div className="p-4 md:p-6 bg-brand-surface border-t border-brand-surface-light relative">
          <div className="flex flex-col gap-2">
            {fileError && (
              <div className="text-red-600 text-sm">{fileError}</div>
            )}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {attachedFiles.map((f, idx) => (
                  <span key={idx} className="flex items-center gap-2 bg-brand-surface-light px-2 py-1 rounded">
                    <span className="truncate max-w-[200px]" title={`${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`}>
                      {f.name} · {(f.size/1024/1024).toFixed(2)} MB
                    </span>
                    <button
                      onClick={() => {
                        setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
                      }}
                      className="text-brand-text-light hover:text-red-600"
                      title="Remove file"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 bg-brand-surface-light rounded-lg px-3 py-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const MAX = 250 * 1024 * 1024;
                  const files = Array.from(e.target.files || []);
                  if (files.length === 0) return;
                  // Auto create conversation on the first attachment
                  if (!activeConversation && !autoCreatedOnTypeRef.current) {
                    autoCreatedOnTypeRef.current = true;
                    handleNewConversation();
                  }
                  // Validate sizes
                  for (const f of files) {
                    if (f.size > MAX) {
                      setFileError(`File \"${f.name}\" is too large. Max 50 MB.`);
                      e.target.value = '';
                      return;
                    }
                  }
                  setFileError(null);
                  setAttachedFiles(prev => {
                    const combined = [...prev, ...files];
                    // Enforce max 10 files like backend
                    return combined.slice(0, 10);
                  });
                  // reset input to allow re-selecting the same file
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-full text-brand-text hover:text-brand-primary hover:bg-brand-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={attachmentHelperText}
                disabled={isLoading || ((agent.model.startsWith('gpt') && (agent.model !== 'gpt-4' && agent.model !== 'gpt-4o')))}
              >
                <PaperClipIcon className="w-5 h-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={currentMessage}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!activeConversation && !autoCreatedOnTypeRef.current && val.trim().length > 0) {
                    autoCreatedOnTypeRef.current = true;
                    handleNewConversation();
                  }
                  setCurrentMessage(val);
                }}
                onInput={adjustTextareaHeight}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type your message..."
                rows={1}
                className="flex-grow bg-transparent focus:outline-none resize-none max-h-40"
                disabled={isLoading}
              />
              {isStreaming ? (
                <button
                  onClick={handleStopStreaming}
                  className="p-2 rounded-full text-red-500 hover:bg-red-500/20 transition-colors flex items-center justify-center"
                  title="Stop generating"
                >
                  <div className="w-5 h-5 bg-red-500 rounded-sm"></div>
                </button>
              ) : (
                <button
                    onClick={handleSendMessage}
                    disabled={isLoading || (!currentMessage.trim() && attachedFiles.length === 0)}
                    className="p-2 rounded-full text-brand-primary disabled:text-brand-text-light disabled:cursor-not-allowed hover:bg-brand-primary/20 transition-colors"
                >
                  <SendIcon className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ConversationItem: React.FC<ConversationItemProps> = ({conversation, isActive, onSelect, onRename, onDelete}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(conversation.title);
  const [showMenu, setShowMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRename = () => {
    const newTitle = editedTitle.trim();
    if (newTitle && newTitle !== conversation.title) {
      onRename(newTitle);
    } else {
      setEditedTitle(conversation.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setEditedTitle(conversation.title);
      setIsEditing(false);
    }
    e.stopPropagation();
  };

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-md text-sm mb-1 ${isActive ? 'bg-brand-surface-light' : 'hover:bg-brand-surface-light'}`}>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          className="flex-grow bg-transparent border-none focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button onClick={onSelect} className="flex-grow text-left truncate">
          {conversation.title}
        </button>
      )}
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={`p-1 rounded hover:bg-black/20 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${isActive ? 'text-white' : 'text-brand-text-light hover:text-brand-primary'}`}
        >
          <EllipsisVerticalIcon className="w-4 h-4"/>
        </button>
        {showMenu && (
          <div
            className="absolute right-0 mt-1 py-1 w-32 bg-brand-surface border border-brand-surface-light rounded-md shadow-lg z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                setIsEditing(true);
              }}
              className="w-full px-3 py-1 text-left text-sm hover:bg-brand-surface-light flex items-center gap-2"
            >
              <EditIcon className="w-4 h-4"/>
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete();
              }}
              className="w-full px-3 py-1 text-left text-sm hover:bg-brand-surface-light flex items-center gap-2 text-red-500"
            >
              <TrashIcon className="w-4 h-4"/>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatView;
