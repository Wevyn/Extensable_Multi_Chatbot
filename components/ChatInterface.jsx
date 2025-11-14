"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';

/**
 * ChatInterface Component
 * Dark-themed chat UI with text and voice input
 * Communicates with Claude backend to process CRM operations
 * Token is automatically read from httpOnly cookie by backend
 */
export default function ChatInterface() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textInputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';

        recognitionRef.current.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPiece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcriptPiece + ' ';
            } else {
              interimTranscript += transcriptPiece;
            }
          }

          setTranscript(finalTranscript + interimTranscript);
          setInputText(finalTranscript + interimTranscript);
        };

        recognitionRef.current.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          if (event.error !== 'no-speech') {
            setIsRecording(false);
          }
        };

        recognitionRef.current.onend = () => {
          if (isRecording) {
            // Auto-restart if still in recording mode
            try {
              recognitionRef.current.start();
            } catch (err) {
              console.error('Failed to restart recognition:', err);
            }
          }
        };
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, [isRecording]);

  /**
   * Toggle voice recording
   */
  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isRecording) {
      // Stop recording
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      // Start recording
      setTranscript('');
      setInputText('');
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start recording:', err);
        alert('Could not start recording. Please check microphone permissions.');
      }
    }
  };

  /**
   * Send message to Claude backend
   * Token is automatically read from httpOnly cookie by backend
   */
  const sendMessage = async () => {
    const messageText = inputText.trim();
    if (!messageText || isProcessing) return;

    // Stop recording if active
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }

    // Add user message to chat
    const userMessage = {
      role: 'user',
      content: messageText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setTranscript('');
    setIsProcessing(true);

    try {
      // Prepare conversation history for context (last 20 messages to avoid token limits)
      // Send previous messages only (current message is sent separately)
      const recentMessages = messages.slice(-20).map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Call backend API (token is automatically read from httpOnly cookie)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include cookies in request
        body: JSON.stringify({
          message: messageText,
          conversationHistory: recentMessages // Send conversation history for context
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process message');
      }

      // Add assistant message to chat
      const assistantMessage = {
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        iterations: data.iterations
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      console.error('Error sending message:', error);

      // Add error message to chat
      const errorMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        timestamp: new Date(),
        isError: true
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
      textInputRef.current?.focus();
    }
  };

  /**
   * Handle key press in text input
   */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-black via-gray-900 to-black text-white">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-2xl px-4">
              <div className="inline-flex p-6 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-white/10 mb-6">
                <div className="text-6xl">💬</div>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
                Hi! I'm Extensible
              </h2>
              <p className="text-gray-400 mb-6 text-base leading-relaxed">
                Your intelligent CRM assistant. Ask me to add contacts, create deals, update records, or anything else in your CRM.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-400">
                <span className="text-indigo-400">💡</span>
                <span>Try: "Add John Smith from Acme Corp as a new contact"</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-300`}
          >
            <div
              className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-3.5 shadow-lg ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                  : msg.isError
                  ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200'
                  : 'glass-effect text-gray-100 border border-white/10'
              }`}
            >
              <div className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
              <div className={`text-xs mt-2.5 flex items-center gap-2 ${
                msg.role === 'user' ? 'opacity-70' : 'opacity-50'
              }`}>
                <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {msg.iterations > 0 && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                    <span>{msg.iterations} tool call{msg.iterations > 1 ? 's' : ''}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="glass-effect border border-white/10 rounded-2xl px-5 py-3.5 flex items-center space-x-3 shadow-lg">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span className="text-sm text-gray-300">Processing your request...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="glass-effect border-t border-white/5 px-4 md:px-8 py-5 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end space-x-3">
            {/* Voice Recording Button */}
            <button
              onClick={toggleRecording}
              disabled={isProcessing}
              className={`flex-shrink-0 p-3.5 rounded-2xl transition-all duration-200 shadow-lg ${
                isRecording
                  ? 'bg-gradient-to-br from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 animate-pulse shadow-rose-500/30'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20'
              } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
              title={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

            {/* Text Input */}
            <div className="flex-1 relative">
              <textarea
                ref={textInputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isProcessing}
                placeholder={isRecording ? 'Listening...' : 'Type a message or use voice...'}
                className="w-full bg-white/5 border border-white/10 text-white rounded-2xl px-5 py-3.5 pr-12 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 placeholder:text-gray-500"
                rows="1"
                style={{
                  minHeight: '54px',
                  maxHeight: '150px'
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
              />

              {/* Transcript Indicator */}
              {isRecording && transcript && (
                <div className="absolute -top-7 right-0 text-xs text-gray-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  <span>Transcribing...</span>
                </div>
              )}
            </div>

            {/* Send Button */}
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || isProcessing}
              className="flex-shrink-0 p-3.5 bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-2xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-105"
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Recording Status */}
          {isRecording && (
            <div className="mt-3 text-sm text-gray-400 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <span className="inline-block w-2 h-2 bg-rose-500 rounded-full animate-pulse shadow-lg shadow-rose-500/50"></span>
              <span>Recording... Click the mic again or press send when done</span>
            </div>
          )}

          {/* Browser Compatibility Warning */}
          {typeof window !== 'undefined' &&
           !window.SpeechRecognition &&
           !window.webkitSpeechRecognition && (
            <div className="mt-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2">
              <span className="flex-shrink-0 mt-0.5">⚠️</span>
              <span>Voice input is not supported in your browser. For voice features, please use Chrome, Edge, or Safari.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
