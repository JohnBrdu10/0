import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import Database from './database.mjs';
import DiscordLogger from './discord/logger.mjs';
import { SERVER_CONFIG } from './config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialisation de la base de données
const db = new Database();

// Initialisation du logger Discord
const discordLogger = new DiscordLogger(SERVER_CONFIG.DISCORD_WEBHOOK_URL);

// Serveur HTTP
const server = createServer();

// Serveur WebSocket
const wss = new WebSocketServer({ 
  server,
  perMessageDeflate: false
});

// Stockage en mémoire
const connectedClients = new Map();
const activeStreams = new Map(); // Map<streamKey, streamData>
const streamViewers = new Map(); // Map<streamKey, Set<clientId>>
const chatContexts = new Map(); // Map<context, Set<clientId>>
const streamChatHistory = new Map(); // Map<streamKey, messages[]>
const globalChatHistory = [];
const globalConnectedUsers = new Set(); // Utilisateurs dans le chat global

// Utilitaires
function generateFingerprint(req, ws) {
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return crypto.createHash('sha256').update(ip + userAgent).digest('hex').substring(0, 16);
}

function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function parseUserAgent(userAgent) {
  const ua = userAgent || '';
  
  // Détection du navigateur
  let browser = 'Unknown';
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  
  // Détection de l'OS
  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS')) os = 'iOS';
  
  // Détection du type d'appareil
  let deviceType = 'Desktop';
  if (ua.includes('Mobile')) deviceType = 'Mobile';
  else if (ua.includes('Tablet')) deviceType = 'Tablet';
  
  return { browser, os, deviceType };
}

function broadcastToAll(message) {
  const messageStr = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.ws.readyState === 1) { // WebSocket.OPEN
      try {
        client.ws.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}

function broadcastToStream(streamKey, message) {
  const viewers = streamViewers.get(streamKey);
  if (!viewers) return;
  
  const messageStr = JSON.stringify(message);
  viewers.forEach(clientId => {
    const client = connectedClients.get(clientId);
    if (client && client.ws.readyState === 1) {
      try {
        client.ws.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting to stream viewer:', error);
      }
    }
  });
}

function broadcastToChatContext(context, message) {
  const users = chatContexts.get(context);
  if (!users) return;
  
  const messageStr = JSON.stringify(message);
  users.forEach(clientId => {
    const client = connectedClients.get(clientId);
    if (client && client.ws.readyState === 1) {
      try {
        client.ws.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting to chat context:', error);
      }
    }
  });
}

function addMessageToHistory(message, streamKey = null) {
  if (streamKey) {
    // Message pour un stream spécifique
    if (!streamChatHistory.has(streamKey)) {
      streamChatHistory.set(streamKey, []);
    }
    const history = streamChatHistory.get(streamKey);
    history.push(message);
    
    // Garder seulement les 50 derniers messages
    if (history.length > 50) {
      history.shift();
    }
  } else {
    // Message global
    globalChatHistory.push(message);
    if (globalChatHistory.length > 50) {
      globalChatHistory.shift();
    }
  }
}

function joinChatContext(clientId, context) {
  if (!chatContexts.has(context)) {
    chatContexts.set(context, new Set());
  }
  chatContexts.get(context).add(clientId);
  
  // Envoyer l'historique du contexte
  const history = context === 'global' ? globalChatHistory : (streamChatHistory.get(context) || []);
  return history;
}

// Gestion des connexions WebSocket
wss.on('connection', async (ws, req) => {
  const clientId = generateUserId();
  const fingerprint = generateFingerprint(req, ws);
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const { browser, os, deviceType } = parseUserAgent(userAgent);
  
  console.log(`[WebSocket] Nouvelle connexion: ${clientId} (${ip})`);
  
  // Vérifier si l'utilisateur est banni
  try {
    const banInfo = await db.isUserBanned(fingerprint, ip);
    if (banInfo) {
      console.log(`[WebSocket] Utilisateur banni tenté de se connecter: ${ip}`);
      ws.send(JSON.stringify({
        type: 'banned',
        message: 'Vous êtes banni de cette plateforme.',
        banInfo: {
          reason: banInfo.reason,
          bannedAt: banInfo.banned_at,
          permanent: banInfo.is_permanent
        }
      }));
      ws.close();
      return;
    }
  } catch (error) {
    console.error('Erreur lors de la vérification du ban:', error);
  }
  
  // Rejoindre automatiquement le chat global
  const globalHistory = joinChatContext(clientId, 'global');
  }
  
  // Stocker les informations du client
  const clientInfo = {
    id: clientId,
    ws: ws,
    ip: ip,
    userAgent: userAgent,
    fingerprint: fingerprint,
    browser: browser,
    os: os,
    deviceType: deviceType,
    connectTime: new Date(),
    lastActivity: new Date(),
    username: null,
    role: 'viewer',
    page: 'unknown',
    currentStream: null
  };
  
  connectedClients.set(clientId, clientInfo);
  
  // Envoyer l'historique du chat global
  ws.send(JSON.stringify({
    type: 'chat_history',
    context: 'global',
    messages: globalHistory
  }));
  
  // Diffuser le nombre d'utilisateurs connectés
  broadcastToAll({
    type: 'user_count',
    count: connectedClients.size
  });
  
  // Envoyer la liste des utilisateurs connectés
  const userList = Array.from(connectedClients.values()).map(client => ({
    id: client.id,
    username: client.username || 'Anonyme',
    ip: client.ip,
    connectTime: client.connectTime,
    lastActivity: client.lastActivity,
    page: client.page,
    role: client.role
  }));
  
  broadcastToAll({
    type: 'user_list',
    users: userList
  });
  
  // Envoyer la liste des streams actifs au nouveau client
  ws.send(JSON.stringify({
    type: 'active_streams',
    streams: Array.from(activeStreams.values())
  }));
  
  // Envoyer la liste des streams disponibles
  ws.send(JSON.stringify({
    type: 'available_streams',
    streams: Array.from(activeStreams.values())
  }));
  
  // Gestion des messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const client = connectedClients.get(clientId);
      
      if (!client) return;
      
      client.lastActivity = new Date();
      
      console.log(`[WebSocket] Message reçu de ${clientId}:`, message.type);
      
      switch (message.type) {
        case 'user_info':
          client.username = message.username;
          client.page = message.page;
          
          // Ajouter à la base de données
          try {
            await db.addConnectedUser({
              id: clientId,
              username: message.username,
              ip: ip,
              userAgent: userAgent,
              page: message.page,
              fingerprint: fingerprint
            });
          } catch (error) {
            console.error('Erreur lors de l\'ajout de l\'utilisateur:', error);
          }
          
          // Log Discord
          await discordLogger.sendLog('user_connected', {
            username: message.username,
            ip: ip,
            os: os,
            deviceType: deviceType,
            browser: browser,
            page: message.page,
            connectTime: client.connectTime
          });
          
          // Mettre à jour la liste des utilisateurs
          const updatedUserList = Array.from(connectedClients.values()).map(c => ({
            id: c.id,
            username: c.username || 'Anonyme',
            ip: c.ip,
            connectTime: c.connectTime,
            lastActivity: c.lastActivity,
            page: c.page,
            role: c.role
          }));
          
          broadcastToAll({
            type: 'user_list',
            users: updatedUserList
          });
          break;
          
        case 'chat_message':
          // Vérifier si l'utilisateur est mute
          try {
            const muteInfo = await db.isUserMuted(fingerprint);
            if (muteInfo) {
              const muteEnd = new Date(muteInfo.mute_end_time);
              const remaining = muteEnd.getTime() - Date.now();
              
              if (remaining > 0) {
                const minutes = Math.floor(remaining / (1000 * 60));
                const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
                
                ws.send(JSON.stringify({
                  type: 'mute_notification',
                  message: `Vous êtes mute pour encore ${minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}`
                }));
                return;
              }
            }
          } catch (error) {
            console.error('Erreur lors de la vérification du mute:', error);
          }
          
          const chatMessage = {
            ...message.message,
            timestamp: new Date().toISOString(),
            ip: ip,
            fingerprint: fingerprint,
            streamKey: client.currentStream // Ajouter la clé de stream si applicable
          };
          
          // Ajouter à la base de données
          try {
            await db.addChatMessage(chatMessage);
          } catch (error) {
            console.error('Erreur lors de l\'ajout du message:', error);
          }
          
          // Déterminer le contexte du message
          const targetContext = message.streamKey || 'global';
          
          if (targetContext !== 'global') {
            // Message pour un stream spécifique
            addMessageToHistory(chatMessage, targetContext);
            broadcastToChatContext(targetContext, {
              type: 'chat_message',
              message: chatMessage
            });
          } else {
            // Message global
            addMessageToHistory(chatMessage);
            broadcastToChatContext('global', {
              type: 'chat_message',
              message: chatMessage
            });
          }
          break;
          
        case 'join_chat_context':
          const context = message.context || 'global';
          const history = joinChatContext(clientId, context);
          
          ws.send(JSON.stringify({
            type: 'chat_history',
            context: context,
            messages: history
          }));
          break;
          
        case 'join_global_chat':
          globalConnectedUsers.add(clientId);
          client.currentStream = null;
          
          // Envoyer l'historique du chat global
          ws.send(JSON.stringify({
            type: 'global_chat_joined',
            success: true,
            chatHistory: globalChatHistory
          }));
          break;
          
        case 'leave_global_chat':
          globalConnectedUsers.delete(clientId);
          break;
          
        case 'join_stream':
          const streamKey = message.streamKey;
          client.currentStream = streamKey;
          globalConnectedUsers.delete(clientId); // Retirer du chat global
          
          // Ajouter aux viewers du stream
          if (!streamViewers.has(streamKey)) {
            streamViewers.set(streamKey, new Set());
          }
          streamViewers.get(streamKey).add(clientId);
          
          // Créer le stream s'il n'existe pas (pour les streams créés manuellement)
          if (!activeStreams.has(streamKey)) {
            activeStreams.set(streamKey, {
              key: streamKey,
              title: `Stream ${streamKey}`,
              description: 'Stream créé automatiquement',
              thumbnail: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&dpr=1',
              startTime: new Date(),
              viewers: 0,
              isLive: true,
              autoDetected: false
            });
            
            // Initialiser l'historique du chat pour ce stream
            if (!streamChatHistory.has(streamKey)) {
              streamChatHistory.set(streamKey, []);
            }
          }
          
          // Mettre à jour le nombre de viewers
          const stream = activeStreams.get(streamKey);
          stream.viewers = streamViewers.get(streamKey).size;
          
          // Envoyer la confirmation et l'historique du chat
          ws.send(JSON.stringify({
            type: 'stream_joined',
            success: true,
            stream: stream,
            chatHistory: streamChatHistory.get(streamKey) || [],
            streamKey: streamKey
          }));
          
          console.log(`[Stream] ${client.username || 'Anonyme'} a rejoint le stream ${streamKey}`);
          
          // Diffuser la mise à jour du nombre de viewers
          broadcastToAll({
            type: 'stream_updated',
            stream: stream,
            streamKey: streamKey
          });
          break;
          
        case 'leave_stream':
          if (client.currentStream) {
            const viewers = streamViewers.get(client.currentStream);
            if (viewers) {
              viewers.delete(clientId);
              
              // Mettre à jour le nombre de viewers
              const stream = activeStreams.get(client.currentStream);
              if (stream) {
                stream.viewers = viewers.size;
                
                // Diffuser la mise à jour
                broadcastToAll({
                  type: 'stream_updated',
                  stream: stream,
                  streamKey: client.currentStream
                });
              }
            }
            client.currentStream = null;
            // Rejoindre automatiquement le chat global
            globalConnectedUsers.add(clientId);
          }
          break;
          
        case 'authenticate':
          let authSuccess = false;
          let authRole = 'viewer';
          let authMessage = 'Authentification échouée';
          
          if (message.context === 'main_auth') {
            // Authentification principale
            if (message.key === SERVER_CONFIG.ENCRYPTION_KEY) {
              authSuccess = true;
              authRole = 'viewer';
              authMessage = 'Authentification réussie';
            }
          } else if (message.context === 'admin_access') {
            // Accès administrateur
            if (message.password === SERVER_CONFIG.ADMIN_ACCESS_CODE) {
              authSuccess = true;
              authRole = 'admin';
              authMessage = 'Accès administrateur accordé';
            }
          } else if (message.context === 'mod_auth') {
            // Authentification modérateur
            const modPasswords = SERVER_CONFIG.MODERATOR_PASSWORDS;
            if (modPasswords[message.role] === message.password) {
              authSuccess = true;
              authRole = message.role;
              authMessage = `Authentification ${message.role} réussie`;
            }
          }
          
          if (authSuccess) {
            client.role = authRole;
          }
          
          ws.send(JSON.stringify({
            type: 'auth_response',
            success: authSuccess,
            role: authRole,
            message: authMessage,
            context: message.context
          }));
          break;
          
        case 'login':
          // Authentification par nom d'utilisateur/mot de passe
          try {
            const user = await db.findUserByUsername(message.username);
            if (user && await bcrypt.compare(message.password, user.password_hash)) {
              // Connexion réussie
              client.username = user.username;
              client.role = user.role;
              
              await db.updateUserLastLogin(user.id);
              
              ws.send(JSON.stringify({
                type: 'login_response',
                success: true,
                user: {
                  id: user.id,
                  username: user.username,
                  role: user.role
                },
                message: 'Connexion réussie'
              }));
            } else {
              ws.send(JSON.stringify({
                type: 'login_response',
                success: false,
                message: 'Nom d\'utilisateur ou mot de passe incorrect'
              }));
            }
          } catch (error) {
            console.error('Erreur lors de la connexion:', error);
            ws.send(JSON.stringify({
              type: 'login_response',
              success: false,
              message: 'Erreur lors de la connexion'
            }));
          }
          break;
          
        case 'register':
          // Inscription d'un nouvel utilisateur
          try {
            const existingUser = await db.findUserByUsername(message.username);
            if (existingUser) {
              ws.send(JSON.stringify({
                type: 'register_response',
                success: false,
                message: 'Ce nom d\'utilisateur est déjà pris'
              }));
              return;
            }
            
            const hashedPassword = await bcrypt.hash(message.password, 10);
            const userId = crypto.randomUUID();
            
            await db.createUser({
              id: userId,
              username: message.username,
              passwordHash: hashedPassword,
              role: 'viewer'
            });
            
            ws.send(JSON.stringify({
              type: 'register_response',
              success: true,
              message: 'Compte créé avec succès'
            }));
          } catch (error) {
            console.error('Erreur lors de l\'inscription:', error);
            ws.send(JSON.stringify({
              type: 'register_response',
              success: false,
              message: 'Erreur lors de la création du compte'
            }));
          }
          break;
          
        case 'delete_message':
          if (client.role === 'moderator' || client.role === 'admin') {
            // Supprimer de la base de données
            try {
              await db.deleteChatMessage(message.messageId);
            } catch (error) {
              console.error('Erreur lors de la suppression du message:', error);
            }
            
            // Supprimer de l'historique local et diffuser
            const context = message.context || 'global';
            if (context !== 'global') {
              const history = streamChatHistory.get(context);
              if (history) {
                const index = history.findIndex(msg => msg.id === message.messageId);
                if (index !== -1) {
                  history.splice(index, 1);
                }
              }
              
              broadcastToChatContext(context, {
                type: 'message_deleted',
                messageId: message.messageId,
                context: context
              });
            } else {
              const index = globalChatHistory.findIndex(msg => msg.id === message.messageId);
              if (index !== -1) {
                globalChatHistory.splice(index, 1);
              }
              
              broadcastToChatContext('global', {
                type: 'message_deleted',
                messageId: message.messageId,
                context: 'global'
              });
            }
            
            // Log Discord
            await discordLogger.sendLog('message_deleted', {
              messageId: message.messageId,
              moderator: client.username,
              ip: ip
            });
          }
          break;
          
        case 'admin_action':
          if (client.role === 'admin' || client.role === 'moderator') {
            const targetClient = Array.from(connectedClients.values())
              .find(c => c.id === message.targetUserId || c.username === message.targetUsername);
            
            if (targetClient) {
              if (message.action === 'mute_user') {
                // Calculer la durée du mute (progression: 5min, 15min, 30min, 1h, permanent)
                let muteCount = 1;
                try {
                  const existingMutes = await db.all(
                    'SELECT COUNT(*) as count FROM muted_users WHERE fingerprint = ?',
                    [targetClient.fingerprint]
                  );
                  muteCount = (existingMutes[0]?.count || 0) + 1;
                } catch (error) {
                  console.error('Erreur lors du comptage des mutes:', error);
                }
                
                const muteDurations = [5, 15, 30, 60, 0]; // 0 = permanent
                const durationMinutes = muteDurations[Math.min(muteCount - 1, muteDurations.length - 1)];
                const muteEndTime = durationMinutes === 0 ? null : new Date(Date.now() + durationMinutes * 60 * 1000);
                
                // Ajouter à la base de données
                try {
                  await db.muteUser({
                    fingerprint: targetClient.fingerprint,
                    username: targetClient.username,
                    ip: targetClient.ip,
                    muteEndTime: muteEndTime,
                    reason: `Mute automatique (infraction #${muteCount})`,
                    mutedBy: client.username,
                    muteCount: muteCount
                  });
                } catch (error) {
                  console.error('Erreur lors du mute:', error);
                }
                
                // Notifier l'utilisateur mute
                targetClient.ws.send(JSON.stringify({
                  type: 'muted',
                  message: durationMinutes === 0 
                    ? 'Vous avez été mute définitivement.' 
                    : `Vous avez été mute pour ${durationMinutes} minutes.`,
                  duration: durationMinutes,
                  muteCount: muteCount
                }));
                
                // Log Discord
                await discordLogger.sendLog('user_muted', {
                  username: targetClient.username,
                  ip: targetClient.ip,
                  os: targetClient.os,
                  deviceType: targetClient.deviceType,
                  browser: targetClient.browser,
                  duration: durationMinutes === 0 ? 'Permanent' : `${durationMinutes} minutes`,
                  count: muteCount,
                  expiresAt: muteEndTime ? muteEndTime.toLocaleString('fr-FR') : 'Jamais',
                  reason: `Mute automatique (infraction #${muteCount})`
                });
                
              } else if (message.action === 'ban_user') {
                // Ban permanent
                try {
                  await db.banUser({
                    fingerprint: targetClient.fingerprint,
                    ip: targetClient.ip,
                    username: targetClient.username,
                    banEndTime: null, // Ban permanent
                    reason: 'Ban administrateur',
                    bannedBy: client.username,
                    isPermanent: true
                  });
                } catch (error) {
                  console.error('Erreur lors du ban:', error);
                }
                
                // Notifier et déconnecter l'utilisateur
                targetClient.ws.send(JSON.stringify({
                  type: 'banned',
                  message: 'Vous avez été banni définitivement de cette plateforme.'
                }));
                
                setTimeout(() => {
                  targetClient.ws.close();
                }, 1000);
                
                // Log Discord
                await discordLogger.sendLog('user_banned', {
                  username: targetClient.username,
                  ip: targetClient.ip,
                  os: targetClient.os,
                  deviceType: targetClient.deviceType,
                  browser: targetClient.browser,
                  permanent: true,
                  reason: 'Ban administrateur'
                });
              }
            }
          }
          break;
          
        case 'admin_command':
          if (client.role === 'admin') {
            let response = { type: 'admin_response', success: false, message: 'Commande inconnue' };
            
            switch (message.command) {
              case 'list_banned':
                try {
                  const bannedUsers = await db.getBannedUsers();
                  response = {
                    type: 'admin_response',
                    success: true,
                    command: 'list_banned',
                    data: bannedUsers,
                    message: `${bannedUsers.length} utilisateur(s) banni(s)`
                  };
                } catch (error) {
                  response.message = 'Erreur lors de la récupération des bans';
                }
                break;
                
              case 'list_muted':
                try {
                  const mutedUsers = await db.getMutedUsers();
                  response = {
                    type: 'admin_response',
                    success: true,
                    command: 'list_muted',
                    data: mutedUsers,
                    message: `${mutedUsers.length} utilisateur(s) mute(s)`
                  };
                } catch (error) {
                  response.message = 'Erreur lors de la récupération des mutes';
                }
                break;
                
              case 'unban_user':
                try {
                  await db.unbanUser(message.params.fingerprint, message.params.ip);
                  response = {
                    type: 'admin_response',
                    success: true,
                    command: 'unban_user',
                    message: 'Utilisateur débanni avec succès'
                  };
                } catch (error) {
                  response.message = 'Erreur lors du déban';
                }
                break;
                
              case 'unmute_user':
                try {
                  await db.unmuteUser(message.params.fingerprint);
                  response = {
                    type: 'admin_response',
                    success: true,
                    command: 'unmute_user',
                    message: 'Utilisateur démuté avec succès'
                  };
                } catch (error) {
                  response.message = 'Erreur lors du démute';
                }
                break;
                
              case 'clear_expired_mutes':
                try {
                  await db.clearExpiredMutes();
                  response = {
                    type: 'admin_response',
                    success: true,
                    command: 'clear_expired_mutes',
                    message: 'Mutes expirés supprimés'
                  };
                } catch (error) {
                  response.message = 'Erreur lors du nettoyage';
                }
                break;
            }
            
            ws.send(JSON.stringify(response));
          }
          break;
          
        default:
          console.log(`[WebSocket] Type de message non géré: ${message.type}`);
      }
    } catch (error) {
      console.error('[WebSocket] Erreur lors du traitement du message:', error);
    }
  });
  
  // Gestion de la déconnexion
  ws.on('close', async () => {
    console.log(`[WebSocket] Déconnexion: ${clientId}`);
    
    const client = connectedClients.get(clientId);
    if (client) {
      // Retirer des viewers du stream
      if (client.currentStream) {
        const viewers = streamViewers.get(client.currentStream);
        if (viewers) {
          viewers.delete(clientId);
          
          // Mettre à jour le nombre de viewers
          const stream = activeStreams.get(client.currentStream);
          if (stream) {
            stream.viewers = viewers.size;
            
            // Diffuser la mise à jour
            broadcastToAll({
              type: 'stream_updated',
              stream: stream,
              streamKey: streamKey
            });
            
            // Notifier qu'un nouveau stream a commencé
            broadcastToAll({
              type: 'stream_started',
              stream: stream,
              streamKey: client.currentStream
            });
          }
        }
      }
      
      // Supprimer de la base de données
      try {
        await db.removeConnectedUser(clientId);
      } catch (error) {
        console.error('Erreur lors de la suppression de l\'utilisateur:', error);
      }
      
      // Log Discord
      if (client.username) {
        const sessionDuration = Date.now() - client.connectTime.getTime();
        await discordLogger.sendLog('user_disconnected', {
          username: client.username,
          ip: client.ip,
          os: client.os,
          deviceType: client.deviceType,
          browser: client.browser,
          sessionDuration: discordLogger.formatDuration(sessionDuration)
        });
      }
    }
    
    // Retirer de tous les contextes de chat
    chatContexts.forEach((users, context) => {
      users.delete(clientId);
      if (users.size === 0 && context !== 'global') {
        chatContexts.delete(context);
      }
    });
    
    globalConnectedUsers.delete(clientId);
    connectedClients.delete(clientId);
    
    // Diffuser le nouveau nombre d'utilisateurs
    broadcastToAll({
      type: 'user_count',
      count: connectedClients.size
    });
    
    // Mettre à jour la liste des utilisateurs
    const userList = Array.from(connectedClients.values()).map(c => ({
      id: c.id,
      username: c.username || 'Anonyme',
      ip: c.ip,
      connectTime: c.connectTime,
      lastActivity: c.lastActivity,
      page: c.page,
      role: c.role
    }));
    
    broadcastToAll({
      type: 'user_list',
      users: userList
    });
  });
  
  ws.on('error', (error) => {
    console.error(`[WebSocket] Erreur pour ${clientId}:`, error);
  });
});

// API REST pour la détection de streams et autres endpoints
server.on('request', (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Route pour la détection de streams RTMP
  if (req.url === '/api/stream/detect' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const streamKey = data.streamKey || `stream_${Date.now()}`;
        
        console.log(`[API] Détection de stream: ${streamKey} (action: ${data.action})`);
        
        if (data.action === 'start') {
          // Créer ou mettre à jour le stream
          const streamData = {
            key: streamKey,
            title: data.title || `Stream Détecté - ${streamKey}`,
            description: data.description || 'Stream détecté automatiquement via RTMP',
            thumbnail: data.thumbnail || 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&dpr=1',
            startTime: new Date(),
            viewers: 0,
            isLive: true,
            autoDetected: true,
            rtmpUrl: data.rtmpUrl,
            hlsUrl: data.hlsUrl
          };
          
          activeStreams.set(streamKey, streamData);
          
          // Initialiser les viewers et l'historique du chat
          if (!streamViewers.has(streamKey)) {
            streamViewers.set(streamKey, new Set());
          }
          if (!streamChatHistory.has(streamKey)) {
            streamChatHistory.set(streamKey, []);
          }
          
          console.log(`[Stream] Nouveau stream détecté: ${streamKey}`);
          
          // Diffuser la mise à jour à tous les clients
          broadcastToAll({
            type: 'stream_detected',
            stream: streamData,
            streamKey: streamKey
          });
          
        } else if (data.action === 'stop') {
          // Arrêter le stream
          if (activeStreams.has(streamKey)) {
            const stream = activeStreams.get(streamKey);
            stream.isLive = false;
            
            console.log(`[Stream] Stream arrêté: ${streamKey}`);
            
            // Diffuser l'arrêt du stream
            broadcastToAll({
              type: 'stream_ended',
              streamKey: streamKey,
              stream: stream
            });
            
            // Supprimer le stream après un délai
            setTimeout(() => {
              activeStreams.delete(streamKey);
              streamViewers.delete(streamKey);
              // Garder l'historique du chat pendant un moment
            }, 30000); // 30 secondes
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: `Stream ${data.action || 'detected'} et référencé`,
          streamKey: streamKey
        }));
        
      } catch (error) {
        console.error('Erreur lors de la détection du stream:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          message: 'Erreur lors de la détection du stream' 
        }));
      }
    });
  }
  
  // Route pour récupérer la liste des streams
  else if (req.url === '/api/streams' && req.method === 'GET') {
    const streams = Array.from(activeStreams.values()).map(stream => ({
      ...stream,
      chatMessageCount: streamChatHistory.get(stream.key)?.length || 0,
      viewerCount: streamViewers.get(stream.key)?.size || 0
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, streams }));
  }
  
  // Route pour créer un stream de test
  else if (req.url === '/api/stream/test' && req.method === 'POST') {
    const testStreamKey = `test-stream-${Date.now()}`;
    
    const streamData = {
      key: testStreamKey,
      title: `Stream de Test - ${testStreamKey}`,
      description: 'Stream de test créé automatiquement',
      thumbnail: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&dpr=1',
      startTime: new Date(),
      viewers: Math.floor(Math.random() * 50) + 10,
      isLive: true,
      autoDetected: true,
      rtmpUrl: `rtmp://localhost:1935/live/${testStreamKey}`,
      hlsUrl: `http://localhost:8000/live/${testStreamKey}.m3u8`
    };
    
    activeStreams.set(testStreamKey, streamData);
    
    // Initialiser les structures de données
    if (!streamViewers.has(testStreamKey)) {
      streamViewers.set(testStreamKey, new Set());
    }
    if (!streamChatHistory.has(testStreamKey)) {
      streamChatHistory.set(testStreamKey, []);
    }
    
    // Diffuser la création du stream de test
    broadcastToAll({
      type: 'stream_detected',
      stream: streamData
    });
    
    console.log(`[Test] Stream de test créé: ${testStreamKey}`);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, streamKey: testStreamKey, stream: streamData }));
  }
  
  // Route pour obtenir les détails d'un stream spécifique
  else if (req.url.startsWith('/api/stream/') && req.method === 'GET') {
    const streamKey = req.url.split('/').pop();
    const stream = activeStreams.get(streamKey);
    
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        stream: stream,
        chatHistory: streamChatHistory.get(streamKey) || []
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Stream non trouvé' }));
    }
  }
  
  // Route de statut du serveur
  else if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      status: 'online',
      connectedUsers: connectedClients.size,
      activeStreams: activeStreams.size,
      globalChatMessages: globalChatHistory.length,
      streamChatMessages: Array.from(streamChatHistory.values()).reduce((total, history) => total + history.length, 0),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  }
  
  // Route par défaut
  else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Endpoint non trouvé' }));
  }
});

// Nettoyage périodique
setInterval(async () => {
  try {
    // Nettoyer les mutes expirés
    await db.clearExpiredMutes();
    
    // Nettoyer les streams inactifs (plus de viewers depuis 30 minutes)
    const now = Date.now();
    for (const [streamKey, stream] of activeStreams.entries()) {
      const viewers = streamViewers.get(streamKey);
      if (!viewers || viewers.size === 0) {
        const inactiveTime = now - stream.startTime.getTime();
        if (inactiveTime > 30 * 60 * 1000) { // 30 minutes
          console.log(`[Cleanup] Suppression du stream inactif: ${streamKey}`);
          activeStreams.delete(streamKey);
          streamViewers.delete(streamKey);
          streamChatHistory.delete(streamKey);
          
          // Notifier les clients
          broadcastToAll({
            type: 'stream_removed',
            streamKey: streamKey
          });
        }
      }
    }
    
    // Nettoyer les connexions fermées
    for (const [clientId, client] of connectedClients.entries()) {
      if (client.ws.readyState !== 1) { // Pas WebSocket.OPEN
        console.log(`[Cleanup] Suppression de la connexion fermée: ${clientId}`);
        connectedClients.delete(clientId);
      }
    }
    
  } catch (error) {
    console.error('Erreur lors du nettoyage périodique:', error);
  }
}, 5 * 60 * 1000); // Toutes les 5 minutes

// Statistiques périodiques pour Discord
setInterval(async () => {
  try {
    await discordLogger.sendLog('server_stats', {
      activeUsers: connectedClients.size,
      totalMessages: globalChatHistory.length,
      mutedUsers: 0, // TODO: Compter les utilisateurs actuellement mutes
      uptime: Math.floor(process.uptime() / 60) + ' minutes'
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi des statistiques Discord:', error);
  }
}, 30 * 60 * 1000); // Toutes les 30 minutes

// Démarrage du serveur
const PORT = SERVER_CONFIG.WS_PORT;

// Fonction pour trouver un port disponible
function findAvailablePort(startPort, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let currentPort = startPort;
    let attempts = 0;
    
    function tryPort() {
      const testServer = server.listen(currentPort, () => {
        testServer.close(() => {
          resolve(currentPort);
        });
      });
      
      testServer.on('error', (err) => {
        attempts++;
        if (err.code === 'EADDRINUSE') {
          if (attempts < maxAttempts) {
            currentPort++;
            console.log(`⚠️ [WebSocket Server] Port ${currentPort - 1} occupé, essai du port ${currentPort}...`);
            tryPort();
          } else {
            reject(new Error(`Impossible de trouver un port disponible après ${maxAttempts} tentatives`));
          }
        } else {
          reject(err);
        }
      });
    }
    
    tryPort();
  });
}

// Démarrer le serveur avec gestion automatique des ports
findAvailablePort(PORT)
  .then((availablePort) => {
    server.listen(availablePort, () => {
      console.log('🚀 [WebSocket Server] Serveur démarré');
      console.log(`📡 [WebSocket Server] Port: ${availablePort}`);
      console.log(`🔐 [WebSocket Server] Sécurité: Activée`);
      console.log(`💾 [WebSocket Server] Base de données: SQLite`);
      console.log(`🤖 [WebSocket Server] Discord: ${SERVER_CONFIG.DISCORD_WEBHOOK_URL ? 'Activé' : 'Désactivé'}`);
      console.log('');
      console.log('📋 [API] Endpoints disponibles:');
      console.log('   - POST /api/stream/detect - Détection de streams RTMP');
      console.log('   - GET  /api/streams - Liste des streams actifs');
      console.log('   - POST /api/stream/test - Créer un stream de test');
      console.log('   - GET  /api/stream/{key} - Détails d\'un stream');
      console.log('   - GET  /api/status - Statut du serveur');
      console.log('');
      console.log('✅ Serveur prêt à accepter les connexions WebSocket et HTTP');
      
      // Mettre à jour la configuration pour les autres services
      if (availablePort !== PORT) {
        console.log(`🔄 [WebSocket Server] Port modifié: ${PORT} → ${availablePort}`);
      }
    });
  })
  .catch((error) => {
    console.error('❌ [WebSocket Server] Erreur lors du démarrage:', error.message);
    process.exit(1);
  });

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du serveur WebSocket...');
  
  // Fermer toutes les connexions WebSocket
  connectedClients.forEach((client) => {
    client.ws.close();
  });
  
  // Fermer la base de données
  db.close();
  
  // Fermer le serveur
  server.close(() => {
    console.log('✅ Serveur WebSocket arrêté proprement');
    process.exit(0);
  });
});

export default server;