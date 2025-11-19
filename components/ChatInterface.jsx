"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';

/**
 * ChatInterface Component
 * Light-themed chat UI with text and voice input matching the pastel gradient design
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
  const chatContainerRef = useRef(null);
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

  const hasMessages = messages.length > 0;

  return (
    <div className="h-screen w-full relative overflow-hidden">
      {/* Main Chat Container */}
      <div className={`h-full flex flex-col items-center p-4 md:p-8 ${hasMessages ? 'justify-start' : 'justify-center'}`}>
        <div className="w-full max-w-4xl h-full flex flex-col">
          {/* Chat Area */}
          <div
            ref={chatContainerRef}
            className={`flex-1 flex flex-col ${hasMessages ? 'justify-start overflow-y-auto pb-4' : 'justify-center items-center'}`}
          >
            {!hasMessages ? (
              <div className="text-center flex flex-col items-center gap-6 w-full">
                <h1 className="text-6xl md:text-7xl">What's New?</h1>
                
                {/* Input Area - Centered */}
                <div className="w-full max-w-3xl bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl flex items-end px-4 py-3 gap-3">
                  <button
                    onClick={toggleRecording}
                    disabled={isProcessing}
                    className={`rounded-full flex-shrink-0 ${isRecording ? 'text-red-500' : 'text-gray-600'} mb-1`}
                  >
                    <Mic className="h-5 w-5" />
                  </button>

                  <textarea
                    ref={textInputRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isProcessing}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 bg-transparent border-none outline-none text-gray-800 placeholder-gray-400 resize-none overflow-y-auto py-2"
                    style={{ maxHeight: '120px' }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      const newHeight = Math.min(e.target.scrollHeight, 120);
                      e.target.style.height = `${newHeight}px`;
                    }}
                  />

                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim() || isProcessing}
                    className="rounded-full flex-shrink-0 text-gray-600 hover:text-purple-600 mb-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 pt-20 pb-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-sm text-gray-700 mb-1 px-2">
                      {msg.role === 'user' ? 'You' : 'Extensable'}
                    </span>
                    <div
                      className={`max-w-[80%] md:max-w-[70%] rounded-3xl px-6 py-4 ${
                        msg.role === 'user'
                          ? 'bg-white/90 text-gray-800 shadow-lg'
                          : msg.isError
                          ? 'bg-rose-50 border border-rose-200 text-rose-700'
                          : 'bg-purple-500/20 text-gray-800 shadow-md'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ))}

                {isProcessing && (
                  <div className="flex flex-col items-start">
                    <span className="text-sm text-gray-700 mb-1 px-2">Extensable</span>
                    <div className="max-w-[80%] md:max-w-[70%] rounded-3xl px-6 py-4 bg-purple-500/20 text-gray-800 shadow-md">
                      <div className="flex items-center space-x-3">
                        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                        <span className="text-sm">Processing your request...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area - Bottom (only shown when there are messages) */}
          {hasMessages && (
            <div className="w-full flex justify-center pb-4">
              <div className="w-full max-w-3xl bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl flex items-end px-4 py-3 gap-3">
                <button
                  onClick={toggleRecording}
                  disabled={isProcessing}
                  className={`rounded-full flex-shrink-0 ${isRecording ? 'text-red-500' : 'text-gray-600'} mb-1`}
                >
                  <Mic className="h-5 w-5" />
                </button>

                <textarea
                  ref={textInputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isProcessing}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none text-gray-800 placeholder-gray-400 resize-none overflow-y-auto py-2"
                  style={{ maxHeight: '120px' }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    const newHeight = Math.min(e.target.scrollHeight, 120);
                    e.target.style.height = `${newHeight}px`;
                  }}
                />

                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isProcessing}
                  className="rounded-full flex-shrink-0 text-gray-600 hover:text-purple-600 mb-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
