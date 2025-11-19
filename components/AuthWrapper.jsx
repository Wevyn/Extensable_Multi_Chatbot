"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, CheckCircle, AlertCircle, X, LogOut, Link2, Mic, Send } from 'lucide-react';
import ChatInterface from './ChatInterface';

const TOOL_CONFIGS = {
  attio: {
    label: 'Attio CRM',
    badge: 'CRM',
    description: 'Sync companies, contacts, and deals directly from your Attio workspace.',
    connectUrl: '/integrations/attio/connect',
    statusUrl: '/integrations/attio/status',
    successMessageType: 'ATTIO_OAUTH_SUCCESS',
    instructions: [
      'Click Continue with Attio.',
      'Sign in to Attio if prompted.',
      'Select the workspace and approve access.'
    ],
    gradient: 'from-indigo-600 to-purple-600'
  },
  google_calendar: {
    label: 'Google Calendar',
    badge: 'Calendar',
    description: 'Read your agenda and schedule meetings without ever leaving the chat.',
    connectUrl: '/integrations/google-calendar/connect',
    statusUrl: '/integrations/google-calendar/status',
    successMessageType: 'GOOGLE_CALENDAR_OAUTH_SUCCESS',
    instructions: [
      'Click Connect Google Calendar.',
      'Choose the Google account you want to use.',
      'Approve calendar access so I can read and create events for you.'
    ],
    gradient: 'from-emerald-500 to-cyan-500'
  }
};

const TOOL_ORDER = ['attio', 'google_calendar'];

/**
 * AuthWrapper Component
 * Handles OAuth authentication for all adapters and wraps the ChatInterface
 */
export default function AuthWrapper() {
  const [connections, setConnections] = useState({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingTool, setConnectingTool] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [heroInput, setHeroInput] = useState('');

  const oauthPopupRef = useRef(null);
  const oauthPollRef = useRef(null);

  // Map success message types back to their tools
  const messageTypeToTool = useMemo(() => {
    return Object.entries(TOOL_CONFIGS).reduce((acc, [tool, config]) => {
      if (config.successMessageType) {
        acc[config.successMessageType] = tool;
      }
      return acc;
    }, {});
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  /**
   * Check authentication status via API
   */
  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status', { credentials: 'include' });
      const data = await response.json();
      const adapterStatuses = data.adapters || {};
      setConnections(adapterStatuses);

      const authenticated = Object.values(adapterStatuses).some(status => status.connected);
      setIsAuthenticated(authenticated);

      return authenticated;
    } catch (error) {
      console.error('Auth status check failed:', error);
      setConnections({});
      setIsAuthenticated(false);
      return false;
    }
  };

  // Listen for OAuth popup messages for all adapters
  useEffect(() => {
    const handler = async (event) => {
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

      clearInterval(oauthPollRef.current);
      setIsConnecting(false);
      setConnectingTool(null);

      const authenticated = await checkAuthStatus();
      if (authenticated) {
        showStatus(`✅ Connected to ${TOOL_CONFIGS[toolName].label}!`, 'success');
      } else {
        showStatus('❌ Connection failed. Please try again.', 'error');
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [messageTypeToTool]);

  /**
   * Start OAuth flow for a specific tool
   */
  const startOAuth = (toolName) => {
    const config = TOOL_CONFIGS[toolName];
    if (!config) return;

    showStatus(`🔐 Opening ${config.label} to connect...`);
    setIsConnecting(true);
    setConnectingTool(toolName);

    const w = 520;
    const h = 640;
    const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;

    oauthPopupRef.current = window.open(
      config.connectUrl,
      `${toolName}_oauth`,
      `width=${w},height=${h},left=${x},top=${y}`
    );

    const pollStartTime = Date.now();
    const POLL_TIMEOUT = 120000; // 2 minutes

    clearInterval(oauthPollRef.current);
    oauthPollRef.current = setInterval(async () => {
      if (Date.now() - pollStartTime > POLL_TIMEOUT) {
        clearInterval(oauthPollRef.current);
        setIsConnecting(false);
        setConnectingTool(null);
        showStatus('⏱️ Connection timeout. Please try again.', 'error');
        if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
          oauthPopupRef.current.close();
        }
        return;
      }

      if (!oauthPopupRef.current || oauthPopupRef.current.closed) {
        clearInterval(oauthPollRef.current);
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
            clearInterval(oauthPollRef.current);
            setIsConnecting(false);
            setConnectingTool(null);
            const authenticated = await checkAuthStatus();
            if (authenticated) {
              showStatus(`✅ Connected to ${config.label}!`, 'success');
            } else {
              showStatus('❌ Connection failed. Please try again.', 'error');
            }
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);
  };

  /**
   * Disconnect from a specific tool
   */
  const handleDisconnect = async (toolName) => {
    const config = TOOL_CONFIGS[toolName];
    if (!config) return;

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
      showStatus(`🔌 Disconnected from ${config.label}`);
    } catch (error) {
      console.error('Logout error:', error);
      showStatus(`⚠️ Could not disconnect from ${config.label}. Please refresh and try again.`, 'error');
    }
  };

  /**
   * Show temporary status message
   */
  const showStatus = (message, type = 'info') => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(''), type === 'error' ? 5000 : 3000);
  };

  const isChatReady = Object.values(connections).some(status => status.connected);

  const handleHeroSend = () => {
    if (!isChatReady) {
      setShowConnectionsModal(true);
      showStatus('Connect at least one tool to start chatting.');
    }
  };

  const handleCloseSettings = () => {
    setSettingsClosing(true);
    setTimeout(() => {
      setShowConnectionsModal(false);
      setSettingsClosing(false);
    }, 300);
  };

  const handleToggleSettings = () => {
    if (showConnectionsModal) {
      handleCloseSettings();
    } else {
      setShowConnectionsModal(true);
    }
  };

  const attioConnected = connections.attio?.connected || false;
  const calendarConnected = connections.google_calendar?.connected || false;

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

  const renderConnectionCard = (tool) => {
    const config = TOOL_CONFIGS[tool];
    const connected = connections[tool]?.connected;
    const busy = isConnecting && connectingTool === tool;

    const handleClick = () => {
      if (busy) return;
      if (connected) {
        handleDisconnect(tool);
      } else {
        startOAuth(tool);
      }
    };

    return (
      <button
        key={tool}
        onClick={handleClick}
        disabled={busy}
        className={`w-48 text-left rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md transition-all duration-200 ${
          connected
            ? 'bg-white/80 border-emerald-200 shadow-emerald-200/60'
            : 'bg-white/60 border-white/40 hover:scale-105 hover:shadow-purple-200/70'
        } ${busy ? 'cursor-wait opacity-70' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-semibold shadow-lg ${
            connected ? 'bg-gradient-to-br from-emerald-400 to-green-500' : 'bg-gradient-to-br from-purple-500 to-indigo-500'
          }`}>
            {connected ? '✓' : config.badge?.[0] || config.label[0]}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900">
              {connected ? `Connected to ${config.label}` : `Connect to ${config.label}`}
            </span>
            <span className={`text-xs ${connected ? 'text-emerald-500' : 'text-gray-500'}`}>
              {connected ? 'Tap to disconnect' : busy ? 'Connecting…' : 'Tap to connect'}
            </span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-pink-200 via-purple-200 to-blue-200 text-gray-900">
      {/* Starfield Background */}
      <div className="absolute inset-0 opacity-60">
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[10%] left-[15%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3s' }}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-[20%] left-[80%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '4s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[30%] left-[40%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '2.5s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[15%] left-[60%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.5s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[50%] left-[25%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '4.5s' }}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-[70%] left-[70%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[80%] left-[30%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '2s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[40%] left-[85%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.8s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[60%] left-[10%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '4.2s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[25%] left-[50%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.2s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[90%] left-[60%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '2.8s' }}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-[5%] left-[35%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.6s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[65%] left-[90%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '4.8s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[35%] left-[20%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.3s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[75%] left-[45%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '2.6s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[12%] left-[70%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '3.7s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[45%] left-[55%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '2.9s' }}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-[55%] left-[75%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '4.1s' }}></div>
        <div className="absolute w-1 h-1 bg-white rounded-full top-[85%] left-[20%] animate-pulse shadow-md shadow-white/40" style={{ animationDuration: '3.4s' }}></div>
        <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[8%] left-[45%] animate-pulse shadow-lg shadow-white/50" style={{ animationDuration: '2.7s' }}></div>
      </div>

      {/* Top Navigation Bar */}
      <div className="relative z-20 flex items-center justify-between px-6 py-4">
        {/* Settings Button - Top Left */}
        <div className="absolute top-6 left-6 z-10">
          <div className="relative">
            <button 
              onClick={handleToggleSettings}
              className="rounded-full bg-white/50 hover:bg-white/70 shadow-xl shadow-purple-300/30 backdrop-blur-md border border-white/60 p-2.5 transition-all hover:scale-105"
            >
              <Settings className="h-5 w-5 text-purple-600" />
            </button>
            
            {showConnectionsModal && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-[-1]" 
                  onClick={handleCloseSettings}
                />
                
                {/* Popout Menu Items */}
                <div className="absolute top-0 left-0 flex flex-col gap-3">
                  <button
                    onClick={() => {
                      handleConnectAttio();
                      handleCloseSettings();
                    }}
                    className={`w-64 ${
                      attioConnected 
                        ? 'bg-gradient-to-br from-purple-100/90 to-pink-100/90 border-purple-300' 
                        : 'bg-white/80 border-white/60'
                    } hover:bg-white/95 backdrop-blur-md border rounded-2xl shadow-xl shadow-purple-200/40 px-4 py-3 transition-all hover:scale-105 transform translate-y-14 ${
                      settingsClosing ? 'animate-out fade-out slide-out-to-left-2 duration-300' : 'animate-in fade-in slide-in-from-left-2 duration-300'
                    }`}
                    style={{ animationDelay: settingsClosing ? '0ms' : '50ms' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-lg">
                        <span className="text-white">{attioConnected ? '✓' : 'A'}</span>
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-gray-800">{attioConnected ? 'Connected to Attio' : 'Connect to Attio'}</span>
                        {attioConnected && <span className="text-xs text-purple-600">Click to disconnect</span>}
                      </div>
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      handleConnectCalendar();
                      handleCloseSettings();
                    }}
                    className={`w-64 ${
                      calendarConnected 
                        ? 'bg-gradient-to-br from-blue-100/90 to-purple-100/90 border-blue-300' 
                        : 'bg-white/80 border-white/60'
                    } hover:bg-white/95 backdrop-blur-md border rounded-2xl shadow-xl shadow-blue-200/40 px-4 py-3 transition-all hover:scale-105 transform translate-y-14 ${
                      settingsClosing ? 'animate-out fade-out slide-out-to-left-2 duration-300' : 'animate-in fade-in slide-in-from-left-2 duration-300'
                    }`}
                    style={{ animationDelay: settingsClosing ? '50ms' : '100ms' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-purple-400 flex items-center justify-center shadow-lg">
                        <span className="text-white">{calendarConnected ? '✓' : '📅'}</span>
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-gray-800">{calendarConnected ? 'Connected to Calendar' : 'Connect to Google Calendar'}</span>
                        {calendarConnected && <span className="text-xs text-blue-600">Click to disconnect</span>}
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Extensable - Top Right */}
        <div className="absolute top-6 right-6 text-2xl font-bold text-gray-800">Extensable</div>
      </div>


      {/* Status Messages */}
      {statusMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-6 py-3 rounded-2xl bg-white/80 shadow-xl border border-white/60 text-sm text-gray-700">
          {statusMessage}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {isChatReady ? (
          <ChatInterface />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 pb-32">
            <div className="max-w-2xl">
              <h1 className="text-6xl md:text-7xl font-bold text-gray-800">What's New?</h1>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
