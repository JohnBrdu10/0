import React, { useState, useEffect, useRef } from 'react';
import { Send, Smile, Flag, Trash2, VolumeX, Ban, Users, MessageCircle, Globe, Radio } from 'lucide-react';
import { ChatMessage, User } from '../types';
import { WebSocketService } from '../services/websocket';
import { formatTime, generateSecureId } from '../utils';

interface ChatSystemProps {
  currentUser: User | null;
  wsService: WebSocketService | null;
  currentContext: 'global' | string; // 'global' ou streamKey
  contextName?: string; // Nom du contexte pour l'affichage
  isAdmin?: boolean;
  isModerator?: boolean;
}

const ChatSystem: React.FC<ChatSystemProps> = ({
  currentUser,
  wsService,
  currentContext,
  contextName,
  isAdmin = false,
  isModerator = false
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll automatique vers le bas
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Gestion des messages WebSocket
  useEffect(() => {
    if (!wsService) return;

    const handleMessage = (data: any) => {
      switch (data.type) {
        case 'chat_message':
          // Vérifier si le message appartient au bon contexte
          const messageContext = data.message.streamKey || 'global';
          if (messageContext === currentContext) {
            const messageWithDate = {
              ...data.message,
              timestamp: new Date(data.message.timestamp)
            };
            setMessages(prev => [...prev.slice(-49), messageWithDate]);
          }
          break;
        case 'user_count':
          setUserCount(data.count);
          break;
        case 'chat_history':
          if (data.context === currentContext) {
            const historyWithDates = data.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp)
            }));
            setMessages(historyWithDates);
          }
          break;
        case 'message_deleted':
          if (data.context === currentContext || !data.context) {
            setMessages(prev => prev.filter(msg => msg.id !== data.messageId));
          }
          break;
        case 'connection_status':
          setIsConnected(data.connected);
          break;
      }
    };

    // Remplacer le callback existant
    const originalCallback = wsService.onMessageCallback;
    wsService.onMessageCallback = (data) => {
      if (originalCallback) originalCallback(data);
      handleMessage(data);
    };

    // Demander l'historique du chat pour ce contexte
    if (wsService.ws?.readyState === WebSocket.OPEN) {
      wsService.ws.send(JSON.stringify({
        type: 'join_chat_context',
        context: currentContext
      }));
    }

    return () => {
      wsService.onMessageCallback = originalCallback;
    };
  }, [wsService, currentContext]);

  // Envoyer un message
  const sendMessage = () => {
    if (!newMessage.trim() || !currentUser || !wsService) return;

    const message: ChatMessage = {
      id: generateSecureId(),
      username: currentUser.username,
      message: newMessage.trim(),
      timestamp: new Date(),
      role: currentUser.role,
      streamKey: currentContext === 'global' ? undefined : currentContext
    };

    wsService.sendMessage(message);
    setNewMessage('');
    inputRef.current?.focus();
  };

  // Supprimer un message (admin/mod)
  const deleteMessage = (messageId: string) => {
    if (!wsService || (!isAdmin && !isModerator)) return;
    
    wsService.ws?.send(JSON.stringify({
      type: 'delete_message',
      messageId,
      context: currentContext
    }));
  };

  // Mute un utilisateur (admin/mod)
  const muteUser = (username: string) => {
    if (!wsService || (!isAdmin && !isModerator)) return;
    
    wsService.ws?.send(JSON.stringify({
      type: 'mute_user',
      username,
      context: currentContext
    }));
  };

  // Ban un utilisateur (admin seulement)
  const banUser = (username: string) => {
    if (!wsService || !isAdmin) return;
    
    wsService.ws?.send(JSON.stringify({
      type: 'ban_user',
      username,
      context: currentContext
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getContextIcon = () => {
    if (currentContext === 'global') {
      return <Globe className="h-4 w-4 text-cyan-400" />;
    }
    return <Radio className="h-4 w-4 text-purple-400" />;
  };

  const getContextColor = () => {
    if (currentContext === 'global') {
      return 'from-cyan-500 to-blue-500';
    }
    return 'from-purple-500 to-pink-500';
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl overflow-hidden">
      {/* Header du chat */}
      <div className={`bg-gradient-to-r ${getContextColor()} p-4 flex items-center justify-between`}>
        <div className="flex items-center space-x-3">
          {getContextIcon()}
          <div>
            <h3 className="text-white font-bold">
              {currentContext === 'global' ? 'Chat Global' : `Stream: ${contextName || currentContext}`}
            </h3>
            <p className="text-white/80 text-sm">
              {userCount} utilisateur{userCount > 1 ? 's' : ''} connecté{userCount > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
          <span className="text-white/80 text-sm">
            {isConnected ? 'Connecté' : 'Déconnecté'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-400">
              {currentContext === 'global' 
                ? 'Aucun message dans le chat global' 
                : 'Aucun message dans ce stream'}
            </p>
            <p className="text-slate-500 text-sm mt-2">Soyez le premier à écrire !</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`p-3 rounded-xl transition-all hover:bg-slate-800/30 ${
                message.isSystem 
                  ? 'bg-blue-500/10 border border-blue-500/30' 
                  : 'bg-slate-800/20'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span
                    className="font-semibold text-sm"
                    style={{ color: message.color || '#64748b' }}
                  >
                    {message.role === 'admin' && '👑'}
                    {message.role === 'moderator' && '🛡️'}
                    {message.username}
                  </span>
                  {message.role === 'admin' && (
                    <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded-full">
                      ADMIN
                    </span>
                  )}
                  {message.role === 'moderator' && (
                    <span className="bg-purple-500/20 text-purple-400 text-xs px-2 py-1 rounded-full">
                      MOD
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-500">
                    {formatTime(message.timestamp)}
                  </span>
                  {(isAdmin || isModerator) && !message.isSystem && (
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => deleteMessage(message.id)}
                        className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => muteUser(message.username)}
                        className="text-orange-400 hover:text-orange-300 p-1 rounded hover:bg-orange-500/10"
                        title="Mute"
                      >
                        <VolumeX className="h-3 w-3" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => banUser(message.username)}
                          className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10"
                          title="Ban"
                        >
                          <Ban className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-slate-200 text-sm break-words leading-relaxed">
                {message.message}
              </p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input de message */}
      <div className="p-4 border-t border-slate-700/50">
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={`Écrivez dans ${currentContext === 'global' ? 'le chat global' : 'ce stream'}...`}
              className="w-full h-12 bg-slate-800/50 border border-slate-600/50 rounded-xl px-4 pr-12 text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/20 transition-all"
              disabled={!isConnected || !currentUser}
              maxLength={500}
            />
            <button
              onClick={() => {/* TODO: Emoji picker */}}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
            >
              <Smile className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim() || !isConnected || !currentUser}
            className="h-12 px-6 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center space-x-2"
          >
            <Send className="h-4 w-4" />
            <span>Envoyer</span>
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{newMessage.length}/500</span>
          <span>Appuyez sur Entrée pour envoyer</span>
        </div>
      </div>
    </div>
  );
};

export default ChatSystem;