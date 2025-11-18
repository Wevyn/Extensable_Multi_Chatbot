"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, CheckCircle, AlertCircle, X, LogOut, Link2 } from 'lucide-react';
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
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingTool, setConnectingTool] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

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

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Connections Modal */}
      {showConnectionsModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-effect rounded-3xl w-full max-w-3xl p-8 relative shadow-2xl border border-white/10 space-y-6 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowConnectionsModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-all duration-200 hover:rotate-90"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-4">
              <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-white/5 to-white/0 mb-4">
                <Link2 size={36} className="text-indigo-300" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Connect your tools
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Plug in any workspace or calendar. I’ll automatically route requests to the right tool.
              </p>
            </div>

            <div className="space-y-6">
              {TOOL_ORDER.map((tool) => {
                const config = TOOL_CONFIGS[tool];
                const connected = connections[tool]?.connected;

                return (
                  <div
                    key={tool}
                    className="border border-white/10 rounded-2xl p-6 bg-white/2 backdrop-blur-sm flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`text-xs font-semibold px-3 py-1 rounded-full bg-white/5 border border-white/10`}>
                          {config.badge}
                        </div>
                        <div
                          className={`flex items-center gap-1.5 text-xs ${
                            connected ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {connected ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                          {connected ? 'Connected' : 'Not Connected'}
                        </div>
                      </div>
                      <h3 className="text-lg font-semibold text-white">{config.label}</h3>
                      <p className="text-gray-400 text-sm mb-4">{config.description}</p>

                      <ol className="text-gray-300 text-sm space-y-2">
                        {config.instructions.map((step, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/5 text-gray-200 flex items-center justify-center text-[11px]">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="flex flex-col gap-2 min-w-[200px]">
                      {connected ? (
                        <button
                          onClick={() => handleDisconnect(tool)}
                          className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all duration-200 border border-white/10 hover:border-white/20 font-medium flex items-center justify-center gap-2"
                        >
                          <LogOut size={16} />
                          Disconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => startOAuth(tool)}
                          disabled={isConnecting && connectingTool !== tool}
                          className={`px-4 py-3 rounded-xl text-white font-medium shadow-lg transition-all duration-200 ${
                            connectingTool === tool
                              ? 'opacity-70 cursor-wait'
                              : 'hover:scale-105'
                          } bg-gradient-to-r ${config.gradient}`}
                        >
                          {connectingTool === tool ? 'Connecting…' : `Connect ${config.label}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="glass-effect border-b border-white/5 px-6 py-4 flex items-center justify-between backdrop-blur-xl">
        <div className="flex flex-wrap gap-3">
          {TOOL_ORDER.map((tool) => {
            const config = TOOL_CONFIGS[tool];
            const connected = connections[tool]?.connected;

            return (
              <div
                key={tool}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border ${
                  connected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
              >
                {connected ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {config.label}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setShowConnectionsModal(true)}
          className="p-2.5 hover:bg-white/5 rounded-xl transition-all duration-200 group"
          title="Manage connections"
        >
          <Settings size={20} className="text-gray-400 group-hover:text-white group-hover:rotate-45 transition-all duration-300" />
        </button>
      </div>

      {/* Status Messages */}
      {statusMessage && (
        <div className="glass-effect border-b border-white/5 px-6 py-3 animate-in slide-in-from-top duration-300">
          <div className="text-sm text-gray-300">{statusMessage}</div>
        </div>
      )}

      {/* Main Content */}
      {isChatReady ? (
        <ChatInterface />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-2xl">
            <div className="inline-flex p-6 rounded-3xl bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-white/5 mb-8 shadow-2xl">
              <AlertCircle size={64} className="text-gray-500" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Connect your tools to get started
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              Link Attio and Google Calendar so I can combine CRM context with meetings and schedules in a single conversation.
            </p>
            <button
              onClick={() => setShowConnectionsModal(true)}
              className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl transition-all duration-200 font-medium shadow-2xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-105"
            >
              Manage connections
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
