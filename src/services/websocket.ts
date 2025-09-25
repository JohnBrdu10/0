import { ChatMessage } from '../types';

export type MessageCallback = (data: any) => void;

export class WebSocketService {
  public ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isReconnecting = false;
  private shouldReconnect = true;
  private onMessageCallback: MessageCallback | null = null;
  
  constructor(onMessageCallback?: MessageCallback) {
    this.onMessageCallback = onMessageCallback || null;
  }

  connect() {
    try {
      // Construire l'URL WebSocket dynamiquement en fonction de l'environnement
      const host = window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      let wsUrl: string;
      
      console.log('Current host:', host);
      console.log('Current protocol:', window.location.protocol);
      
      if (host.includes('webcontainer-api.io') || host.includes('ws://localhost:3001')) {
        // Environnement WebContainer
        // Dans WebContainer, remplacer le port 5173 par 3001
        const wsHost = host.replace('-5173.', '-3001.');
        wsUrl = `${protocol}//${wsHost}`;
        console.log('WebContainer environment detected, using:', wsUrl);
      } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
        // Environnement local
        wsUrl = `ws://localhost:3001`;
        console.log('Local environment detected, using:', wsUrl);
      } else {
        // Autres environnements - essayer d'abord avec le même host
        wsUrl = `${protocol}//${host}`;
        console.log('Other environment detected, using:', wsUrl);
      }
      
      console.log('Attempting to connect to WebSocket:', wsUrl);
      
      // Vérifier si une connexion existe déjà
      if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
        console.log('WebSocket connection already exists, skipping...');
        return;
      }
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected successfully');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        
        // Effacer le timeout de reconnexion s'il existe
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
        
        // Envoyer un ping pour maintenir la connexion
        this.sendPing();
      };

      this.ws.onmessage = (event) => {
        try {
          // console.log('Received WebSocket message:', event.data);
          const data = JSON.parse(event.data);
          
          // Appeler le callback si défini
          if (this.onMessageCallback) {
            this.onMessageCallback(data);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason, 'wasClean:', event.wasClean);
        this.ws = null;
        
        // Tenter une reconnexion si la fermeture est anormale et que nous devons nous reconnecter
        if (this.shouldReconnect && !this.isReconnecting && event.code !== 1000) {
          this.reconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error details:', {
          error,
          readyState: this.ws?.readyState,
          url: this.ws?.url,
          timestamp: new Date().toISOString()
        });
        
        // Fermer la connexion en cas d'erreur pour forcer une reconnexion
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      if (this.shouldReconnect && !this.isReconnecting) {
        this.reconnect();
      }
    }
  }
  
  private sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } catch (error) {
        console.error('Error sending ping:', error);
      }
    }
  }
  
  private reconnect() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached. Giving up.');
      }
      return;
    }
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    // Délai croissant: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.isReconnecting = false;
      // Nettoyer l'ancienne connexion avant de reconnecter
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.connect();
    }, delay);
  }
  
  disconnect() {
    this.shouldReconnect = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
  }
  
  sendMessage(chatMessage: ChatMessage) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Convertir la date en string pour la sérialisation JSON
        const messageToSend = {
          ...chatMessage,
          timestamp: chatMessage.timestamp instanceof Date ? chatMessage.timestamp.toISOString() : chatMessage.timestamp
        };
        
        console.log('Sending WebSocket message:', messageToSend);
        
        this.ws.send(JSON.stringify({
          type: 'chat_message',
          message: messageToSend
        }));
        
        console.log('WebSocket message sent successfully');
      } else {
        console.warn('WebSocket not open. Message not sent. ReadyState:', this.ws?.readyState);
        // Tenter une reconnexion si la connexion est fermée
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this.reconnect();
        }
      }
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      throw error;
    }
  }
  
  sendDeleteMessage(messageId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'delete_message',
        messageId: messageId
      }));
    } else {
      console.warn('WebSocket not open. Delete message not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendUserInfo(username: string, page: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'user_info',
        username: username,
        page: page
      }));
    } else {
      console.warn('WebSocket not open. User info not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendAdminAction(action: string, targetUserId?: string, targetUsername?: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'admin_action',
        action: action,
        targetUserId: targetUserId,
        targetUsername: targetUsername
      }));
    } else {
      console.warn('WebSocket not open. Admin action not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendAdminCommand(command: string, params?: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'admin_command',
        command: command,
        params: params || {}
      }));
    } else {
      console.warn('WebSocket not open. Admin command not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendAuthentication(key: string, role?: string, password?: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Déterminer le contexte d'authentification
      let context = 'main_auth';
      if (role === 'admin' && key === 'admin_access') {
        context = 'admin_access';
      } else if (role === 'moderator' || role === 'admin') {
        context = 'mod_auth';
      }
      
      this.ws.send(JSON.stringify({
        type: 'authenticate',
        key: key,
        role: role,
        password: password,
        context: context
      }));
    } else {
      console.warn('WebSocket not open. Authentication not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendLogin(username: string, password: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'login',
        username: username,
        password: password
      }));
    } else {
      console.warn('WebSocket not open. Login not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendRegister(username: string, password: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'register',
        username: username,
        password: password
      }));
    } else {
      console.warn('WebSocket not open. Registration not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
  
  sendStreamStatus(status: 'live' | 'offline', viewers?: number) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'stream_status',
        status: status,
        viewers: viewers
      }));
    } else {
      console.warn('WebSocket not open. Stream status not sent.');
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.reconnect();
      }
    }
  }
}