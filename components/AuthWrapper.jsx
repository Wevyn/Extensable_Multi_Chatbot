"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Settings, CheckCircle, AlertCircle, X, LogOut } from 'lucide-react';
import ChatInterface from './ChatInterface';

/**
 * AuthWrapper Component
 * Handles Attio OAuth authentication and wraps the ChatInterface
 * Preserves existing OAuth flow from original implementation
 */
export default function AuthWrapper() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const oauthPopupRef = useRef(null);
  const oauthPollRef = useRef(null);

  const OAUTH_START_URL = '/integrations/attio/connect';

  // Check authentication status on mount (reads from httpOnly cookie via API)
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
      const authenticated = data.authenticated || false;
      setIsAuthenticated(authenticated);
      // Close setup modal if authentication succeeds
      if (authenticated) {
        setShowSetupModal(false);
      }
      return authenticated;
    } catch (error) {
      console.error('Auth status check failed:', error);
      setIsAuthenticated(false);
      return false;
    }
  };

  // Listen for OAuth popup messages
  useEffect(() => {
    const handler = async (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data || {};

      // Token is now stored in httpOnly cookie, so we just check auth status
      if (data.type === 'ATTIO_OAUTH_SUCCESS') {
        if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
          try {
            oauthPopupRef.current.close();
          } catch {}
        }
        clearInterval(oauthPollRef.current);
        setIsConnecting(false);
        // Check auth status to confirm token was saved in cookie
        const authenticated = await checkAuthStatus();
        if (authenticated) {
          showStatus('✅ Connected to Attio!', 'success');
        } else {
          showStatus('❌ Connection failed. Please try again.', 'error');
        }
      } else if (data.type === 'ATTIO_OAUTH_ERROR' && data.message) {
        setIsConnecting(false);
        showStatus(`❌ ${data.message}`, 'error');
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  /**
   * Start OAuth flow
   */
  const startOAuth = () => {
    showStatus('🔐 Opening Attio to connect your workspace...');
    setIsConnecting(true);

    const w = 520,
      h = 640;
    const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;

    oauthPopupRef.current = window.open(
      OAUTH_START_URL,
      'attio_oauth',
      `width=${w},height=${h},left=${x},top=${y}`
    );

    // Safety: Stop polling after 2 minutes (120 seconds)
    const pollStartTime = Date.now();
    const POLL_TIMEOUT = 120000; // 2 minutes

    clearInterval(oauthPollRef.current);
    oauthPollRef.current = setInterval(async () => {
      // Check if polling has timed out
      if (Date.now() - pollStartTime > POLL_TIMEOUT) {
        clearInterval(oauthPollRef.current);
        setIsConnecting(false);
        showStatus('⏱️ Connection timeout. Please try again.', 'error');
        if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
          oauthPopupRef.current.close();
        }
        return;
      }

      if (!oauthPopupRef.current || oauthPopupRef.current.closed) {
        clearInterval(oauthPollRef.current);
        setIsConnecting(false);
        return;
      }

      try {
        const res = await fetch('/integrations/attio/status', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json && json.access_token) {
            // Token was retrieved from temporary cookie, now check auth status
            oauthPopupRef.current.close();
            clearInterval(oauthPollRef.current);
            setIsConnecting(false);
            const authenticated = await checkAuthStatus();
            if (authenticated) {
              showStatus('✅ Connected to Attio!', 'success');
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

  // Removed validateAndSaveToken - token is now stored in httpOnly cookie by callback route
  // We just check auth status via API

  /**
   * Disconnect from Attio - clears httpOnly cookie via API
   */
  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      setIsAuthenticated(false);
      showStatus('🔌 Disconnected from Attio');
    } catch (error) {
      console.error('Logout error:', error);
      // Still update UI even if API call fails
      setIsAuthenticated(false);
      showStatus('🔌 Disconnected from Attio');
    }
  };

  /**
   * Show temporary status message
   */
  const showStatus = (message, type = 'info') => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(''), type === 'error' ? 5000 : 3000);
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Setup Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-effect rounded-3xl max-w-md w-full p-8 relative shadow-2xl border border-white/10">
            <button
              onClick={() => setShowSetupModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-all duration-200 hover:rotate-90"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-8">
              <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 mb-4">
                <Settings size={48} className="text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Connect your Attio workspace
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Sign in, pick your workspace, and grant access. That's it.
              </p>
            </div>

            <ol className="mb-8 text-gray-300 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">1</span>
                <span>Click <strong className="text-white">Continue with Attio</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">2</span>
                <span>Sign in to Attio (if prompted)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">3</span>
                <span>Select the workspace and approve access</span>
              </li>
            </ol>

            <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-4 mb-8 text-xs text-gray-300 leading-relaxed">
              We'll open a secure Attio window. When you finish, this page will auto-connect.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSetupModal(false)}
                className="flex-1 px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all duration-200 border border-white/10 hover:border-white/20 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={startOAuth}
                disabled={isConnecting}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 font-medium"
              >
                {isConnecting ? 'Connecting…' : 'Continue with Attio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="glass-effect border-b border-white/5 px-6 py-4 flex items-center justify-between backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 ${
              isAuthenticated
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/10'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
            }`}
          >
            {isAuthenticated ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {isAuthenticated ? 'Attio Connected' : 'Not Connected'}
          </div>

          {isAuthenticated && (
            <button
              onClick={handleDisconnect}
              className="text-xs text-gray-400 hover:text-white transition-all duration-200 flex items-center gap-1.5 hover:gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              <LogOut size={12} />
              Disconnect
            </button>
          )}
        </div>

        <button
          onClick={() => setShowSetupModal(true)}
          className="p-2.5 hover:bg-white/5 rounded-xl transition-all duration-200 group"
          title="Settings"
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
      {isAuthenticated ? (
        <ChatInterface />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="inline-flex p-6 rounded-3xl bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-white/5 mb-8 shadow-2xl">
              <AlertCircle size={64} className="text-gray-500" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
              Welcome to Extensible
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              Connect your Attio workspace to start managing your CRM through natural conversation.
            </p>
            <button
              onClick={() => setShowSetupModal(true)}
              className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl transition-all duration-200 font-medium shadow-2xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-105"
            >
              Connect to Attio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
