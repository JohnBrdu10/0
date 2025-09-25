import React, { useState, useEffect } from 'react';
import { Shield, Users, Activity, Settings, Plus, Trash2, Eye, Ban, VolumeX, Server, Lock, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Circle as XCircle, Play, Pause, Monitor, Database, Wifi, Globe, Key, Crown, Zap, ChartBar as BarChart3, Radio, Layers, Terminal, FileVideoCamera as FileVideo, Link, Save, X, MessageCircle } from 'lucide-react';
import { ConnectedUser, ChatMessage, StreamSource, SecurityLog } from '../types';
import ChatSystem from './ChatSystem';
import { formatTime, generateSecureId, validateM3U8Url, sanitizeInput } from '../utils';

interface AdminPanelProps {
  currentUser: any;
  connectedUsers: ConnectedUser[];
  chatMessages: ChatMessage[];
  wsService: any;
  onStreamSourceChange: (source: StreamSource | null) => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUser,
  connectedUsers,
  chatMessages,
  wsService,
  onStreamSourceChange
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'streams' | 'security' | 'settings'>('dashboard');
  const [streamSources, setStreamSources] = useState<StreamSource[]>([]);
  const [activeSource, setActiveSource] = useState<StreamSource | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
  const [adminChatContext, setAdminChatContext] = useState<'global' | string>('global');
  const [availableStreams, setAvailableStreams] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [systemStats, setSystemStats] = useState({
    uptime: 0,
    totalConnections: 0,
    activeStreams: 0,
    securityAlerts: 0
  });

  // Écouter les mises à jour des streams
  useEffect(() => {
    if (wsService) {
      const originalCallback = wsService.onMessageCallback;
      wsService.onMessageCallback = (data) => {
        if (originalCallback) originalCallback(data);
        
        if (data.type === 'available_streams') {
          setAvailableStreams(data.streams || []);
        }
      };
      
      return () => {
        wsService.onMessageCallback = originalCallback;
      };
    }
  }, [wsService]);

  useEffect(() => {
    // Charger les sources de stream depuis localStorage
    const savedSources = localStorage.getItem('streamSources');
    if (savedSources) {
      const sources = JSON.parse(savedSources);
      setStreamSources(sources);
      const active = sources.find((s: StreamSource) => s.isActive);
      if (active) {
        setActiveSource(active);
        onStreamSourceChange(active);
      }
    }

    // Charger les logs de sécurité
    const savedLogs = localStorage.getItem('securityLogs');
    if (savedLogs) {
      setSecurityLogs(JSON.parse(savedLogs));
    }

    // Simuler les statistiques système
    const interval = setInterval(() => {
      setSystemStats(prev => ({
        ...prev,
        uptime: prev.uptime + 1,
        totalConnections: connectedUsers.length,
        activeStreams: streamSources.filter(s => s.isActive).length,
        securityAlerts: securityLogs.filter(log => log.severity === 'high' || log.severity === 'critical').length
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [connectedUsers.length, streamSources, securityLogs, onStreamSourceChange]);

  // Fonctions de gestion des streams
  const activateStream = (sourceId: string) => {
    const source = streamSources.find(s => s.id === sourceId);
    if (source && wsService) {
      wsService.ws?.send(JSON.stringify({
        type: 'activate_stream',
        streamSource: source
      }));
      toggleStreamSource(sourceId);
    }
  };

  const addStreamSource = () => {
    if (!newSourceUrl.trim() || !newSourceName.trim()) {
      alert('Veuillez remplir tous les champs');
      return;
    }

    if (!validateM3U8Url(newSourceUrl)) {
      alert('URL invalide. Veuillez entrer une URL valide.');
      return;
    }

    const newSource: StreamSource = {
      id: generateSecureId(),
      name: sanitizeInput(newSourceName),
      url: newSourceUrl.trim(),
      type: newSourceUrl.includes('.m3u8') ? 'm3u8' : 'mp4',
      isActive: false,
      createdAt: new Date(),
      createdBy: currentUser?.username || 'Admin'
    };

    const updatedSources = [...streamSources, newSource];
    setStreamSources(updatedSources);
    localStorage.setItem('streamSources', JSON.stringify(updatedSources));

    setNewSourceUrl('');
    setNewSourceName('');
    setShowAddForm(false);

    // Log de sécurité
    addSecurityLog('STREAM_SOURCE_ADDED', `Nouvelle source ajoutée: ${newSource.name}`, 'medium');
  };

  const uploadM3U8File = async (streamKey: string, file: File) => {
    const content = await file.text();
    
    // Envoyer au serveur média
    const response = await fetch('http://localhost:8000/api/upload-m3u8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey, content })
    });
    
    return response.json();
  };

  const toggleStreamSource = (sourceId: string) => {
    const updatedSources = streamSources.map(source => ({
      ...source,
      isActive: source.id === sourceId ? !source.isActive : false
    }));

    setStreamSources(updatedSources);
    localStorage.setItem('streamSources', JSON.stringify(updatedSources));

    const newActiveSource = updatedSources.find(s => s.isActive) || null;
    setActiveSource(newActiveSource);
    onStreamSourceChange(newActiveSource);
    
    // Notifier le serveur WebSocket
    if (wsService && newActiveSource) {
      wsService.ws?.send(JSON.stringify({
        type: 'stream_activated',
        stream: newActiveSource
      }));
    }

    addSecurityLog('STREAM_STATUS_CHANGED', `Source ${newActiveSource ? 'activée' : 'désactivée'}`, 'low');
  };

  const deleteStreamSource = (sourceId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette source ?')) return;

    const sourceToDelete = streamSources.find(s => s.id === sourceId);
    const updatedSources = streamSources.filter(source => source.id !== sourceId);
    
    setStreamSources(updatedSources);
    localStorage.setItem('streamSources', JSON.stringify(updatedSources));

    if (activeSource?.id === sourceId) {
      setActiveSource(null);
      onStreamSourceChange(null);
    }

    addSecurityLog('STREAM_SOURCE_DELETED', `Source supprimée: ${sourceToDelete?.name}`, 'medium');
  };

  const handleFileUpload = async (sourceId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.name.endsWith('.m3u8')) {
      alert('Veuillez sélectionner un fichier M3U8 valide');
      return;
    }
    
    const result = await uploadM3U8File(sourceId, file);
    if (result.success) {
      alert('Fichier M3U8 uploadé avec succès !');
    }
  };

  const addSecurityLog = (action: string, details: string, severity: 'low' | 'medium' | 'high' | 'critical') => {
    const newLog: SecurityLog = {
      id: generateSecureId(),
      action,
      username: currentUser?.username,
      ip: 'localhost',
      timestamp: new Date(),
      details,
      severity
    };

    const updatedLogs = [newLog, ...securityLogs].slice(0, 100);
    setSecurityLogs(updatedLogs);
    localStorage.setItem('securityLogs', JSON.stringify(updatedLogs));
  };

  const renderChatManagement = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2">
        <div className="h-[600px]">
          <ChatSystem
            currentUser={currentUser}
            wsService={wsService}
            currentContext={adminChatContext}
            contextName={adminChatContext === 'global' ? undefined : availableStreams.find(s => s.key === adminChatContext)?.name}
            isAdmin={true}
            isModerator={true}
          />
        </div>
      </div>
      <div className="lg:col-span-1">
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-4">Contextes de Chat</h3>
          <div className="space-y-3">
            <button
              onClick={() => setAdminChatContext('global')}
              className={`w-full p-3 rounded-xl text-left transition-all ${
                adminChatContext === 'global'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
              }`}
            >
              <Globe className="h-4 w-4 inline mr-2" />
              Chat Global
            </button>
            {availableStreams.map((stream) => (
              <button
                key={stream.key}
                onClick={() => setAdminChatContext(stream.key)}
                className={`w-full p-3 rounded-xl text-left transition-all ${
                  adminChatContext === stream.key
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <Radio className="h-4 w-4 inline mr-2" />
                {stream.name}
                <span className="text-xs opacity-75 block">
                  {stream.viewers || 0} viewer{(stream.viewers || 0) > 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-8">
      {/* Statistiques modernes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { 
            label: 'Utilisateurs connectés', 
            value: connectedUsers.length, 
            icon: Users, 
            color: 'from-blue-500 to-cyan-500',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20'
          },
          { 
            label: 'Messages chat', 
            value: chatMessages.length, 
            icon: Activity, 
            color: 'from-emerald-500 to-green-500',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
          },
          { 
            label: 'Sources actives', 
            value: streamSources.filter(s => s.isActive).length, 
            icon: Radio, 
            color: 'from-violet-500 to-purple-500',
            bg: 'bg-violet-500/10',
            border: 'border-violet-500/20'
          },
          { 
            label: 'Alertes sécurité', 
            value: systemStats.securityAlerts, 
            icon: AlertTriangle, 
            color: 'from-red-500 to-orange-500',
            bg: 'bg-red-500/10',
            border: 'border-red-500/20'
          }
        ].map((stat, index) => (
          <div key={index} className={`${stat.bg} backdrop-blur-sm border ${stat.border} rounded-2xl p-6 hover:scale-105 transition-all duration-300`}>
            <div className={`w-14 h-14 bg-gradient-to-r ${stat.color} rounded-2xl flex items-center justify-center mb-4 shadow-lg`}>
              <stat.icon className="h-7 w-7 text-white" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">{stat.value}</div>
            <div className="text-slate-400 text-sm font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* État du système moderne */}
      <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-3xl p-8">
        <h3 className="text-2xl font-bold text-white mb-8 flex items-center">
          <Server className="h-7 w-7 mr-3 text-emerald-400" />
          État du Système
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center group hover:scale-105 transition-all duration-300">
            <div className="w-20 h-20 bg-emerald-500/10 backdrop-blur-sm border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:shadow-lg group-hover:shadow-emerald-500/25">
              <CheckCircle className="h-10 w-10 text-emerald-400" />
            </div>
            <h4 className="text-xl font-bold text-white mb-3">Serveur WebSocket</h4>
            <div className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 rounded-xl">
              <p className="text-emerald-400 font-semibold">En ligne</p>
            </div>
          </div>
          <div className="text-center group hover:scale-105 transition-all duration-300">
            <div className="w-20 h-20 bg-blue-500/10 backdrop-blur-sm border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:shadow-lg group-hover:shadow-blue-500/25">
              <Database className="h-10 w-10 text-blue-400" />
            </div>
            <h4 className="text-xl font-bold text-white mb-3">Base de données</h4>
            <div className="px-4 py-2 bg-blue-500/20 border border-blue-500/30 rounded-xl">
              <p className="text-blue-400 font-semibold">Connectée</p>
            </div>
          </div>
          <div className="text-center group hover:scale-105 transition-all duration-300">
            <div className="w-20 h-20 bg-violet-500/10 backdrop-blur-sm border border-violet-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:shadow-lg group-hover:shadow-violet-500/25">
              <Radio className="h-10 w-10 text-violet-400" />
            </div>
            <h4 className="text-xl font-bold text-white mb-3">Streaming</h4>
            <div className={`px-4 py-2 rounded-xl border ${activeSource ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-slate-500/20 border-slate-500/30'}`}>
              <p className={activeSource ? "text-emerald-400 font-semibold" : "text-slate-400 font-semibold"}>
                {activeSource ? 'Actif' : 'Inactif'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Graphique d'activité (simulé) */}
      <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-3xl p-8">
        <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
          <BarChart3 className="h-7 w-7 mr-3 text-violet-400" />
          Activité en Temps Réel
        </h3>
        <div className="h-32 bg-slate-800/50 rounded-2xl flex items-end justify-center space-x-2 p-4">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="bg-gradient-to-t from-violet-500 to-fuchsia-500 rounded-t-lg animate-pulse"
              style={{
                height: `${Math.random() * 80 + 20}%`,
                width: '20px',
                animationDelay: `${i * 0.1}s`
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderStreams = () => (
    <div className="space-y-8">
      {/* Header avec bouton d'ajout */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Gestion des Sources</h2>
          <p className="text-slate-400">Gérez vos flux de streaming M3U8</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white px-6 py-3 rounded-2xl font-semibold transition-all transform hover:scale-105 shadow-lg flex items-center space-x-2"
        >
          <Plus className="h-5 w-5" />
          <span>Ajouter une Source</span>
        </button>
      </div>

      {/* Modal d'ajout */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 z-50">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-bold text-white flex items-center">
                <FileVideo className="h-7 w-7 mr-3 text-violet-400" />
                Nouvelle Source
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  Nom de la source
                </label>
                <input
                  type="text"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="Ex: Stream Principal"
                  className="w-full h-12 bg-slate-800/50 backdrop-blur-sm border border-slate-600/50 rounded-xl px-4 text-white placeholder-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-400/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-3">
                  URL du flux M3U8
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder="https://exemple.com/stream.m3u8"
                    className="w-full h-12 bg-slate-800/50 backdrop-blur-sm border border-slate-600/50 rounded-xl px-4 pl-12 text-white placeholder-slate-400 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-400/20 transition-all"
                  />
                  <Link className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                </div>
              </div>
            </div>
            
            <div className="flex space-x-4 mt-8">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 py-3 px-4 rounded-xl font-semibold transition-all"
              >
                Annuler
              </button>
              <button
                onClick={addStreamSource}
                disabled={!newSourceName.trim() || !newSourceUrl.trim()}
                className="flex-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-50 text-white py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center space-x-2"
              >
                <Save className="h-5 w-5" />
                <span>Ajouter</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des sources */}
      <div className="grid grid-cols-1 gap-6">
        {streamSources.map((source) => (
          <div key={source.id} className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:scale-[1.02] transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <input
                type="file"
                accept=".m3u8"
                onChange={(e) => handleFileUpload(source.id, e)}
                className="hidden"
                id={`file-${source.id}`}
              />
              <label
                htmlFor={`file-${source.id}`}
                className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 rounded-xl cursor-pointer transition-all flex items-center space-x-2"
              >
                <FileVideo className="h-4 w-4" />
                <span>Upload M3U8</span>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-4 mb-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
                    <FileVideo className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white">{source.name}</h4>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        source.isActive 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                          : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}>
                        {source.isActive ? '🔴 ACTIF' : '⚫ INACTIF'}
                      </span>
                      <span className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full text-xs font-semibold">
                        {source.type.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-3 mb-3">
                  <p className="text-slate-300 text-sm font-mono break-all">{source.url}</p>
                </div>
                <p className="text-slate-500 text-sm">
                  Créé par <span className="text-violet-400 font-semibold">{source.createdBy}</span> le {formatTime(source.createdAt)}
                </p>
              </div>
              <div className="flex items-center space-x-3 ml-6">
                <button
                  onClick={() => activateStream(source.id)}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all transform hover:scale-105 flex items-center space-x-2 ${
                    source.isActive 
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30' 
                      : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                  }`}
                >
                  {source.isActive ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  <span>{source.isActive ? 'Arrêter' : 'Démarrer'}</span>
                </button>
                <button
                  onClick={() => deleteStreamSource(source.id)}
                  className="text-red-400 hover:text-red-300 p-3 rounded-xl hover:bg-red-500/10 border border-red-500/20 transition-all transform hover:scale-105"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {streamSources.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-slate-800/50 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Monitor className="h-10 w-10 text-slate-500" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-3">Aucune source configurée</h3>
            <p className="text-slate-400 text-lg mb-8">Ajoutez votre première source de streaming M3U8</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white px-8 py-4 rounded-2xl font-semibold transition-all transform hover:scale-105 shadow-lg"
            >
              Ajouter une Source
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSecurity = () => (
    <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-3xl p-8">
      <h3 className="text-2xl font-bold text-white mb-8 flex items-center">
        <Shield className="h-7 w-7 mr-3 text-red-400" />
        Logs de Sécurité
      </h3>
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {securityLogs.map((log) => (
          <div key={log.id} className={`p-4 rounded-xl border backdrop-blur-sm ${
            log.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
            log.severity === 'high' ? 'bg-orange-500/10 border-orange-500/30' :
            log.severity === 'medium' ? 'bg-yellow-500/10 border-yellow-500/30' :
            'bg-slate-800/50 border-slate-700/50'
          }`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-3">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  log.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                  log.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                  log.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {log.severity.toUpperCase()}
                </span>
                <span className="text-white font-semibold">{log.action}</span>
              </div>
              <span className="text-slate-500 text-sm font-mono">{formatTime(log.timestamp)}</span>
            </div>
            <p className="text-slate-300 text-sm mb-3">{log.details}</p>
            <div className="flex items-center space-x-4 text-xs text-slate-500">
              {log.username && <span>👤 {log.username}</span>}
              <span>🌐 {log.ip}</span>
            </div>
          </div>
        ))}
        {securityLogs.length === 0 && (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-500 text-lg">Aucun log de sécurité</p>
          </div>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
    { id: 'chat', label: 'Gestion Chat', icon: MessageCircle },
    { id: 'streams', label: 'Sources Stream', icon: Radio },
    { id: 'users', label: 'Utilisateurs', icon: Users },
    { id: 'security', label: 'Sécurité', icon: Shield },
    { id: 'settings', label: 'Paramètres', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header moderne */}
        <div className="mb-8">
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center space-x-6">
              <div className="w-20 h-20 bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-orange-500/25">
                <Crown className="h-10 w-10 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-orange-400 to-yellow-400 mb-2">
                  PANNEAU ADMIN
                </h1>
                <p className="text-slate-400 text-lg font-medium">Contrôle total de la plateforme ABD Stream</p>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation moderne */}
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-2 mb-8 shadow-xl">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-3 px-6 py-4 rounded-xl font-semibold transition-all transform hover:scale-105 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Contenu */}
        <div className="animate-in fade-in-0 duration-500">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'chat' && renderChatManagement()}
          {activeTab === 'streams' && renderStreams()}
          {activeTab === 'users' && renderUsers()}
          {activeTab === 'security' && renderSecurity()}
          {activeTab === 'settings' && (
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-3xl p-8">
              <h3 className="text-2xl font-bold text-white mb-6 flex items-center">
                <Settings className="h-7 w-7 mr-3 text-slate-400" />
                Paramètres Système
              </h3>
              <div className="text-center py-12">
                <Terminal className="h-16 w-16 mx-auto mb-4 text-slate-600" />
                <p className="text-slate-400 text-lg">Fonctionnalités à venir...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderUsers = () => (
    <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-3xl p-8">
      <h3 className="text-2xl font-bold text-white mb-8 flex items-center">
        <Users className="h-7 w-7 mr-3 text-blue-400" />
        Gestion des Utilisateurs
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 py-3">Utilisateur</th>
              <th className="text-left text-slate-400 py-3">IP</th>
              <th className="text-left text-slate-400 py-3">Page</th>
              <th className="text-left text-slate-400 py-3">Connecté depuis</th>
              <th className="text-left text-slate-400 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {connectedUsers.map((user) => (
              <tr key={user.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-white font-medium">{user.username}</span>
                  </div>
                </td>
                <td className="py-4 text-slate-300 font-mono text-sm">{user.ip}</td>
                <td className="py-4 text-slate-300">{user.page}</td>
                <td className="py-4 text-slate-400 text-sm">
                  {Math.floor((Date.now() - user.connectTime.getTime()) / 60000)} min
                </td>
                <td className="py-4">
                  <div className="flex items-center space-x-2">
                    <button className="text-orange-400 hover:text-orange-300 p-2 rounded-lg hover:bg-orange-500/10 transition-all">
                      <VolumeX className="h-4 w-4" />
                    </button>
                    <button className="text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-500/10 transition-all">
                      <Ban className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminPanel;