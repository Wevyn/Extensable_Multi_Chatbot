"use client";

import { useState, useRef, useEffect, useMemo } from 'react';
import { Settings, Mic, Send, Check } from 'lucide-react';
import { Button } from './ui/button';

const TOOL_CONFIGS = {
  attio: {
    label: 'Attio CRM',
    connectUrl: '/integrations/attio/connect',
    statusUrl: '/integrations/attio/status',
    successMessageType: 'ATTIO_OAUTH_SUCCESS',
  },
  google_calendar: {
    label: 'Google Calendar',
    connectUrl: '/integrations/google-calendar/connect',
    statusUrl: '/integrations/google-calendar/status',
    successMessageType: 'GOOGLE_CALENDAR_OAUTH_SUCCESS',
  }
};

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

/**
 * Format message text for better readability
 * Converts lists, schedules, and structured content into formatted HTML
 */
function formatMessage(text: string) {
  // Split by double newlines to preserve paragraphs
  const paragraphs = text.split(/\n\n+/);
  
  return paragraphs.map((para, idx) => {
    const trimmed = para.trim();
    if (!trimmed) return null;
    
    // Check if it's a list item (starts with *, -, •, or number)
    const listItemMatch = trimmed.match(/^[\*\-\•]\s+(.+)$/);
    const numberedItemMatch = trimmed.match(/^(\d+)[\.\)]\s+(.+)$/);
    
    // Check if it's a date header (e.g., "Today (2025-11-19):", "Thursday (2025-11-20):")
    const dateHeaderMatch = trimmed.match(/^(\*\*)?([A-Za-z]+day|Today|Tomorrow)\s*\([0-9\-]+\):?\s*\*\*?$/);
    
    // Check if it's a schedule item (contains time ranges like "6:50 PM - 7:50 PM" or "11:00 AM - 12:00 PM")
    // Also handles formats like "A flight from SFO Airport (6:50 PM - 7:50 PM)"
    const scheduleItemMatch = trimmed.match(/^[\*\-\•]\s*(.+?)\s+\((\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM))\)/);
    
    if (dateHeaderMatch) {
      return (
        <div key={idx} style={{ marginTop: idx > 0 ? '20px' : '0', marginBottom: '12px' }}>
          <strong style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
            {trimmed.replace(/\*\*/g, '')}
          </strong>
        </div>
      );
    }
    
    if (scheduleItemMatch) {
      const [, eventName, timeRange] = scheduleItemMatch;
      return (
        <div key={idx} style={{ marginLeft: '24px', marginBottom: '10px', paddingLeft: '12px', borderLeft: '3px solid rgba(180, 140, 220, 0.6)' }}>
          <span style={{ fontWeight: '500', display: 'block', marginBottom: '2px' }}>{eventName.trim()}</span>
          <span style={{ color: '#6b7280', fontSize: '15px' }}>{timeRange}</span>
        </div>
      );
    }
    
    if (listItemMatch) {
      return (
        <div key={idx} style={{ marginLeft: '20px', marginBottom: '6px', paddingLeft: '8px' }}>
          <span style={{ marginRight: '8px' }}>•</span>
          <span>{listItemMatch[1]}</span>
        </div>
      );
    }
    
    if (numberedItemMatch) {
      return (
        <div key={idx} style={{ marginLeft: '20px', marginBottom: '6px', paddingLeft: '8px' }}>
          <span style={{ marginRight: '8px', fontWeight: '600' }}>{numberedItemMatch[1]}.</span>
          <span>{numberedItemMatch[2]}</span>
        </div>
      );
    }
    
    // Check if paragraph contains multiple lines that look like a list
    const lines = trimmed.split('\n');
    if (lines.length > 1) {
      // Check if most lines start with list markers or are date headers
      const listLines = lines.filter(line => {
        const trimmedLine = line.trim();
        return /^[\*\-\•\d]+[\.\)]\s/.test(trimmedLine) || 
               /^([A-Za-z]+day|Today|Tomorrow)\s*\([0-9\-]+\):?/.test(trimmedLine) ||
               /\((\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM))\)/.test(trimmedLine);
      });
      
      if (listLines.length >= lines.length * 0.5) {
        // It's a list or schedule, format each line
        return (
          <div key={idx} style={{ marginBottom: '8px' }}>
            {lines.map((line, lineIdx) => {
              const trimmedLine = line.trim();
              if (!trimmedLine) return null;
              
              // Check for date header
              const dateMatch = trimmedLine.match(/^(\*\*)?([A-Za-z]+day|Today|Tomorrow)\s*\([0-9\-]+\):?\s*\*\*?$/);
              if (dateMatch) {
                return (
                  <div key={lineIdx} style={{ marginTop: lineIdx > 0 ? '16px' : '0', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                      {trimmedLine.replace(/\*\*/g, '')}
                    </strong>
                  </div>
                );
              }
              
              // Check for schedule item with time
              const scheduleMatch = trimmedLine.match(/^[\*\-\•]\s*(.+?)\s+\((\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM))\)/);
              if (scheduleMatch) {
                const [, eventName, timeRange] = scheduleMatch;
                return (
                  <div key={lineIdx} style={{ marginLeft: '24px', marginBottom: '10px', paddingLeft: '12px', borderLeft: '3px solid rgba(180, 140, 220, 0.6)' }}>
                    <span style={{ fontWeight: '500', display: 'block', marginBottom: '2px' }}>{eventName.trim()}</span>
                    <span style={{ color: '#6b7280', fontSize: '15px' }}>{timeRange}</span>
                  </div>
                );
              }
              
              const bulletMatch = trimmedLine.match(/^[\*\-\•]\s+(.+)$/);
              const numMatch = trimmedLine.match(/^(\d+)[\.\)]\s+(.+)$/);
              
              if (bulletMatch) {
                return (
                  <div key={lineIdx} style={{ marginLeft: '20px', marginBottom: '6px', paddingLeft: '8px' }}>
                    <span style={{ marginRight: '8px' }}>•</span>
                    <span>{bulletMatch[1]}</span>
                  </div>
                );
              }
              
              if (numMatch) {
                return (
                  <div key={lineIdx} style={{ marginLeft: '20px', marginBottom: '6px', paddingLeft: '8px' }}>
                    <span style={{ marginRight: '8px', fontWeight: '600' }}>{numMatch[1]}.</span>
                    <span>{numMatch[2]}</span>
                  </div>
                );
              }
              
              // Regular line
              return (
                <div key={lineIdx} style={{ marginBottom: '4px' }}>
                  {trimmedLine}
                </div>
              );
            })}
          </div>
        );
      }
    }
    
    // Regular paragraph
    return (
      <div key={idx} style={{ marginBottom: idx < paragraphs.length - 1 ? '12px' : '0', lineHeight: '1.6' }}>
        {trimmed}
      </div>
    );
  }).filter(Boolean);
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [connections, setConnections] = useState<Record<string, { connected: boolean }>>({});
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingTool, setConnectingTool] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollRef = useRef<NodeJS.Timeout | null>(null);

  const attioConnected = connections.attio?.connected || false;
  const calendarConnected = connections.google_calendar?.connected || false;

  // Debug: Log connection status
  useEffect(() => {
    console.log('Connection status:', { attioConnected, calendarConnected, connections });
  }, [attioConnected, calendarConnected, connections]);

  const hasMessages = messages.length > 0;

  const messageTypeToTool = useMemo(() => {
    return Object.entries(TOOL_CONFIGS).reduce((acc, [tool, config]) => {
      if (config.successMessageType) {
        acc[config.successMessageType] = tool;
      }
      return acc;
    }, {} as Record<string, string>);
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data || {};

      const toolName = messageTypeToTool[data.type];
      if (!toolName) {
        return;
      }

      if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
        try {
          oauthPopupRef.current.close();
        } catch {}
      }

      if (oauthPollRef.current) {
        clearInterval(oauthPollRef.current);
      }
      setIsConnecting(false);
      setConnectingTool(null);

      await checkAuthStatus();
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [messageTypeToTool]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [inputValue]);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status', { credentials: 'include' });
      const data = await response.json();
      const adapterStatuses = data.adapters || {};
      setConnections(adapterStatuses);
      return Object.values(adapterStatuses).some((status: any) => status.connected);
    } catch (error) {
      console.error('Auth status check failed:', error);
      setConnections({});
      return false;
    }
  };

  const startOAuth = (toolName: string) => {
    const config = TOOL_CONFIGS[toolName as keyof typeof TOOL_CONFIGS];
    if (!config) return;

    setIsConnecting(true);
    setConnectingTool(toolName);

    const w = 520;
    const h = 640;
    const topWindow = window.top || window;
    const y = topWindow.outerHeight / 2 + topWindow.screenY - h / 2;
    const x = topWindow.outerWidth / 2 + topWindow.screenX - w / 2;

    oauthPopupRef.current = window.open(
      config.connectUrl,
      `${toolName}_oauth`,
      `width=${w},height=${h},left=${x},top=${y}`
    );

    const pollStartTime = Date.now();
    const POLL_TIMEOUT = 120000;

    if (oauthPollRef.current) {
      clearInterval(oauthPollRef.current);
    }
    oauthPollRef.current = setInterval(async () => {
      if (Date.now() - pollStartTime > POLL_TIMEOUT) {
        if (oauthPollRef.current) {
          clearInterval(oauthPollRef.current);
        }
        setIsConnecting(false);
        setConnectingTool(null);
        if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
          oauthPopupRef.current.close();
        }
        return;
      }

      if (!oauthPopupRef.current || oauthPopupRef.current.closed) {
        if (oauthPollRef.current) {
          clearInterval(oauthPollRef.current);
        }
        setIsConnecting(false);
        setConnectingTool(null);
        return;
      }

      try {
        const res = await fetch(config.statusUrl, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json && json.access_token) {
            oauthPopupRef.current.close();
            if (oauthPollRef.current) {
              clearInterval(oauthPollRef.current);
            }
            setIsConnecting(false);
            setConnectingTool(null);
            await checkAuthStatus();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);
  };

  const handleDisconnect = async (toolName: string) => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tool: toolName })
      });
      await checkAuthStatus();
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === '') return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          message: messageText,
          conversationHistory: messages.slice(-20).map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text
          }))
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process message');
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.response || "I'm here to help! How can I assist you further?",
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleVoiceInput = () => {
    setIsRecording(!isRecording);
    // Voice input functionality would be implemented here
  };

  const handleConnectAttio = () => {
    if (attioConnected) {
      handleDisconnect('attio');
    } else {
      startOAuth('attio');
    }
  };

  const handleConnectCalendar = () => {
    if (calendarConnected) {
      handleDisconnect('google_calendar');
    } else {
      startOAuth('google_calendar');
    }
  };

  const handleCloseSettings = () => {
    setSettingsClosing(true);
    setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 300);
  };

  const handleToggleSettings = () => {
    if (settingsOpen) {
      handleCloseSettings();
    } else {
      setSettingsOpen(true);
    }
  };

  return (
    <div className="min-h-screen w-full bg-figma-gradient relative">
      {/* Floating particles (sparkles) - CSS pattern */}
    <div 
        className="pointer-events-none absolute inset-0 opacity-40"
      style={{
          backgroundImage: `radial-gradient(circle at 15% 10%, white 1px, transparent 1px),
                            radial-gradient(circle at 80% 20%, white 1px, transparent 1px),
                            radial-gradient(circle at 40% 30%, white 1px, transparent 1px),
                            radial-gradient(circle at 60% 15%, white 1px, transparent 1px),
                            radial-gradient(circle at 25% 50%, white 1px, transparent 1px),
                            radial-gradient(circle at 70% 70%, white 1px, transparent 1px),
                            radial-gradient(circle at 30% 80%, white 1px, transparent 1px),
                            radial-gradient(circle at 85% 40%, white 1px, transparent 1px),
                            radial-gradient(circle at 10% 60%, white 1px, transparent 1px),
                            radial-gradient(circle at 50% 25%, white 1px, transparent 1px),
                            radial-gradient(circle at 60% 90%, white 1px, transparent 1px),
                            radial-gradient(circle at 35% 5%, white 1px, transparent 1px),
                            radial-gradient(circle at 90% 65%, white 1px, transparent 1px),
                            radial-gradient(circle at 20% 35%, white 1px, transparent 1px),
                            radial-gradient(circle at 45% 75%, white 1px, transparent 1px),
                            radial-gradient(circle at 70% 12%, white 1px, transparent 1px),
                            radial-gradient(circle at 55% 45%, white 1px, transparent 1px),
                            radial-gradient(circle at 75% 55%, white 1px, transparent 1px),
                            radial-gradient(circle at 20% 85%, white 1px, transparent 1px),
                            radial-gradient(circle at 45% 8%, white 1px, transparent 1px)`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'repeat'
        }}
      ></div>

      {/* Settings Panel */}
      <div className="absolute top-8 left-8 z-10" style={{ top: '32px', left: '32px' }}>
        <div className="relative">
          <button 
            onClick={handleToggleSettings}
            className="rounded-full bg-white/50 hover:bg-white/70 shadow-xl shadow-purple-300/30 backdrop-blur-md border border-white/60 p-4 transition-all hover:scale-105"
            style={{ padding: '16px' }}
          >
            <Settings className="h-7 w-7 text-purple-600" style={{ height: '20px', width: '20px' }} />
          </button>
          
          {settingsOpen && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 z-[-1]" 
                onClick={handleCloseSettings}
              />
              
              {/* Popout Menu Items */}
              <div className="absolute top-0 left-0 flex flex-col gap-5 transform translate-y-14" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <button
                  onClick={handleConnectAttio}
                  className={`bg-white rounded-2xl shadow-sm px-4 transition-all hover:shadow-md border border-gray-200 ${
                    settingsClosing ? 'animate-out fade-out slide-out-to-left-2 duration-300' : 'animate-in fade-in slide-in-from-left-2 duration-300'
                  }`}
                  style={{ width: '380px', height: '75px', marginBottom: '20px', animationDelay: settingsClosing ? '0ms' : '50ms' }}
                >
                  <div className="flex items-center gap-3 h-full">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden p-2.75" style={{ marginLeft: '12px', marginRight: '12px' }}>
                      <img 
                        src="/attio-logo.png" 
                        alt="Attio" 
                        className="object-contain"
                        style={{ width: '35px', height: '35px', maxWidth: '35px', maxHeight: '35px' }}
                        onError={(e) => {
                          // Fallback to letter if image fails to load
                          e.currentTarget.style.display = 'none';
                          const fallback = document.createElement('span');
                          fallback.className = 'text-black text-xl font-bold';
                          fallback.textContent = 'A';
                          e.currentTarget.parentElement?.appendChild(fallback);
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-start flex-1">
                      <span style={{ color: '#000000', fontSize: '20px', fontWeight: '600', fontFamily: 'inherit' }}>{attioConnected ? 'Connected to Attio' : 'Connect to Attio'}</span>
                    </div>
                    {attioConnected && (
                      <div className="rounded-full flex items-center justify-center flex-shrink-0 shadow-sm" style={{ width: '28px', height: '28px', marginRight: '16px', minWidth: '28px', backgroundColor: '#10b981' }}>
                        <Check className="text-white" style={{ width: '18px', height: '18px', strokeWidth: 3 }} />
                      </div>
                    )}
                  </div>
                </button>
                
                <button
                  onClick={handleConnectCalendar}
                  className={`bg-white rounded-2xl shadow-sm px-4 transition-all hover:shadow-md border border-gray-200 ${
                    settingsClosing ? 'animate-out fade-out slide-out-to-left-2 duration-300' : 'animate-in fade-in slide-in-from-left-2 duration-300'
                  }`}
                  style={{ width: '380px', height: '75px', animationDelay: settingsClosing ? '50ms' : '100ms' }}
                >
                  <div className="flex items-center gap-3 h-full">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden p-2.75" style={{ marginLeft: '12px', marginRight: '12px' }}>
                      <img 
                        src="/google-calendar-logo.png" 
                        alt="Google Calendar" 
                        className="object-contain"
                        style={{ width: '35px', height: '35px', maxWidth: '35px', maxHeight: '35px' }}
                        onError={(e) => {
                          // Fallback to calendar icon if image fails to load
                          e.currentTarget.style.display = 'none';
                          const fallback = document.createElement('div');
                          fallback.className = 'text-center leading-tight';
                          fallback.innerHTML = `
                            <div class="text-red-500 text-[10px] uppercase tracking-tight font-semibold">JUL</div>
                            <div class="text-black text-lg font-bold">17</div>
                          `;
                          e.currentTarget.parentElement?.appendChild(fallback);
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-start flex-1">
                      <span style={{ color: '#000000', fontSize: '20px', fontWeight: '600', fontFamily: 'inherit' }}>{calendarConnected ? 'Connected to Calendar' : 'Connect to Google Calendar'}</span>
                    </div>
                    {calendarConnected && (
                      <div className="rounded-full flex items-center justify-center flex-shrink-0 shadow-sm" style={{ width: '28px', height: '28px', marginRight: '16px', minWidth: '28px', backgroundColor: '#10b981' }}>
                        <Check className="text-white" style={{ width: '18px', height: '18px', strokeWidth: 3 }} />
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Chat Container */}
      <div
        className={`flex flex-col items-center w-full overflow-x-hidden ${hasMessages ? 'h-screen' : ''}`}
        style={!hasMessages ? { paddingTop: '25vh' } : {}}
      >
        <div className={`w-full ${hasMessages ? 'flex flex-col h-full' : 'max-w-3xl mx-auto'}`}>
          {/* Chat Area */}
          <div
            ref={chatContainerRef}
            className={`flex flex-col ${hasMessages ? 'flex-1 overflow-y-auto pt-32 pb-4' : 'justify-center items-center'}`}
          >
            {!hasMessages ? (
              <div className="text-center flex flex-col items-center gap-6 w-full">
                <h1 className="text-[100px] md:text-[150px] !font-thin" style={{ fontWeight: 300 }}>What's New?</h1>
                
                {/* Input Area - Centered, Wider, Larger Radius, Softer Shadow */}
                <div className="mt-[34px] bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] flex items-center min-h-[72px]" style={{ width: '1000px', maxWidth: '1000px' }}>
                  <button onClick={handleVoiceInput} className="bg-transparent border-none outline-none p-0" style={{ marginLeft: '40px', marginRight: '12px' }}>
                    <Mic className="w-5 h-5 text-gray-500" />
                  </button>
                  
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 bg-transparent border-0 outline-none text-gray-800 placeholder-gray-400 resize-none overflow-y-auto px-4 py-6 custom-scrollbar"
                    style={{ maxHeight: '120px', fontSize: '1.2rem' }}
                  />

                  <button onClick={handleSendMessage} className="bg-transparent border-none outline-none p-0" style={{ marginLeft: '12px', marginRight: '40px' }}>
                    <Send className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full" style={{ paddingLeft: 'max(16px, calc((100vw - 1000px) / 2 - 80px))', paddingRight: 'max(16px, calc((100vw - 1000px) / 2 - 80px))' }}>
                <div className="space-y-4" style={{ marginTop: '40px', maxWidth: '1000px', marginLeft: 'auto', marginRight: 'auto' }}>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex flex-col ${message.sender === 'user' ? 'items-end' : 'items-start'}`}
                      style={{
                        width: 'fit-content',
                        maxWidth: '60%',
                        marginLeft: message.sender === 'user' ? 'auto' : '0',
                        marginRight: message.sender === 'user' ? '0' : 'auto',
                        transform: message.sender === 'user' ? 'translateX(80px)' : 'translateX(-80px)'
                      }}
                    >
                      <span className="text-sm text-gray-700 mb-3 px-2" style={{ color: '#1f2937', fontSize: '16px', fontWeight: '600' }}>
                        {message.sender === 'user' ? 'You' : 'Extensable'}
                      </span>
                      <div
                        className={`rounded-2xl ${
                          message.sender === 'user'
                            ? 'bg-white text-gray-800 shadow-sm'
                            : 'text-gray-800 shadow-sm'
                        }`}
                        style={{
                          width: 'fit-content',
                          maxWidth: '100%',
                          backgroundColor: message.sender === 'user' ? '#ffffff' : 'rgba(180, 140, 220, 0.85)',
                          padding: '16px 20px',
                          wordWrap: 'break-word',
                          overflowWrap: 'break-word'
                        }}
                      >
                        <div style={{ color: '#111827', fontSize: '17px', lineHeight: '1.6', margin: 0, fontWeight: '500' }}>
                          {formatMessage(message.text)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div
                      className="flex flex-col items-start"
                      style={{
                        width: 'fit-content',
                        maxWidth: '60%',
                        marginLeft: '0',
                        marginRight: 'auto',
                        transform: 'translateX(-80px)'
                      }}
                    >
                      <span className="text-sm text-gray-700 mb-3 px-2" style={{ color: '#1f2937', fontSize: '16px', fontWeight: '600' }}>
                        Extensable
                      </span>
                      <div
                        className="rounded-2xl text-gray-800 shadow-sm"
                        style={{
                          width: 'fit-content',
                          maxWidth: '100%',
                          backgroundColor: 'rgba(180, 140, 220, 0.85)',
                          padding: '16px 20px',
                        }}
                      >
                        <div className="flex items-center gap-1" style={{ minWidth: '40px' }}>
                          <span 
                            className="inline-block rounded-full bg-gray-600"
                            style={{
                              width: '8px',
                              height: '8px',
                              animation: 'dot1 1.4s infinite ease-in-out',
                              animationDelay: '0s'
                            }}
                          />
                          <span 
                            className="inline-block rounded-full bg-gray-600"
                            style={{
                              width: '8px',
                              height: '8px',
                              animation: 'dot2 1.4s infinite ease-in-out',
                              animationDelay: '0.2s'
                            }}
                          />
                          <span 
                            className="inline-block rounded-full bg-gray-600"
                            style={{
                              width: '8px',
                              height: '8px',
                              animation: 'dot3 1.4s infinite ease-in-out',
                              animationDelay: '0.4s'
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}
          </div>

          {/* Input Area - Bottom (only shown when there are messages) */}
          {hasMessages && (
            <div className="w-full flex justify-center pb-6 pt-4" style={{ marginBottom: "24px" }}>
              <div className="mx-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] flex items-center min-h-[72px]" style={{ width: '1000px', maxWidth: '1000px' }}>
                <button onClick={handleVoiceInput} className="bg-transparent border-none outline-none p-0" style={{ marginLeft: '40px', marginRight: '12px' }}>
                  <Mic className="w-5 h-5 text-gray-500" />
                </button>
                
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 bg-transparent border-0 outline-none text-gray-800 placeholder-gray-400 resize-none overflow-y-auto px-4 py-6 custom-scrollbar"
                  style={{ maxHeight: '120px', fontSize: '1.2rem' }}
                />

                <button onClick={handleSendMessage} className="bg-transparent border-none outline-none p-0" style={{ marginLeft: '12px', marginRight: '40px' }}>
                  <Send className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
