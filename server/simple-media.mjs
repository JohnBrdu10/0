import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🎥 [Simple Media Server] Démarrage du serveur média simplifié...');

// Créer le dossier media s'il n'existe pas
const mediaDir = join(__dirname, 'media');
const liveDir = join(mediaDir, 'live');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
  console.log('📁 Dossier media créé:', mediaDir);
}
if (!fs.existsSync(liveDir)) {
  fs.mkdirSync(liveDir, { recursive: true });
  console.log('📁 Dossier live créé:', liveDir);
}

// Serveur HTTP simple pour servir les fichiers média
const server = createServer((req, res) => {
  // Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>ABD Media Server</title></head>
        <body>
          <h1>🎥 ABD Media Server</h1>
          <p>Serveur média simplifié en fonctionnement</p>
          <p>Port: 8000</p>
          <p>Status: ✅ Actif</p>
          <h2>Streams disponibles:</h2>
          <ul>
            ${fs.readdirSync(liveDir).map(dir => 
              `<li><a href="/live/${dir}/index.m3u8">${dir}</a></li>`
            ).join('')}
          </ul>
        </body>
      </html>
    `);
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'active',
      server: 'ABD Media Server',
      port: 8000,
      availableStreams: fs.readdirSync(liveDir),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // API pour uploader un fichier M3U8
  if (req.url === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { streamKey, m3u8Content } = data;
        
        if (!streamKey || !m3u8Content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'streamKey et m3u8Content requis' }));
          return;
        }
        
        // Créer le dossier du stream
        const streamDir = join(liveDir, streamKey);
        if (!fs.existsSync(streamDir)) {
          fs.mkdirSync(streamDir, { recursive: true });
        }
        
        // Sauvegarder le fichier M3U8
        const m3u8Path = join(streamDir, 'index.m3u8');
        fs.writeFileSync(m3u8Path, m3u8Content);
        
        console.log(`📁 Fichier M3U8 sauvegardé pour le stream: ${streamKey}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Fichier M3U8 uploadé avec succès',
          streamUrl: `http://localhost:8000/live/${streamKey}/index.m3u8`
        }));
      } catch (error) {
        console.error('Erreur lors de l\'upload:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Erreur serveur' }));
      }
    });
    return;
  }

  // API pour uploader des fichiers M3U8
  if (req.url === '/api/upload-m3u8' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { streamKey, content } = data;
        
        if (!streamKey || !content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'streamKey et content requis' }));
          return;
        }
        
        // Créer le dossier pour le stream
        const streamDir = join(mediaDir, 'live', streamKey);
        if (!fs.existsSync(streamDir)) {
          fs.mkdirSync(streamDir, { recursive: true });
        }
        
        // Écrire le fichier M3U8
        const m3u8Path = join(streamDir, 'index.m3u8');
        fs.writeFileSync(m3u8Path, content);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Fichier M3U8 uploadé avec succès',
          path: `/live/${streamKey}/index.m3u8`
        }));
        
      } catch (error) {
        console.error('Erreur upload M3U8:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Erreur serveur' }));
      }
    });
    return;
  }

  // API pour obtenir les statistiques des streams
  if (req.url === '/api/stats' && req.method === 'GET') {
    try {
      const liveDir = join(mediaDir, 'live');
      const streams = [];
      
      if (fs.existsSync(liveDir)) {
        const streamDirs = fs.readdirSync(liveDir);
        streamDirs.forEach(streamKey => {
          const streamPath = join(liveDir, streamKey);
          const m3u8Path = join(streamPath, 'index.m3u8');
          
          if (fs.existsSync(m3u8Path)) {
            const stats = fs.statSync(m3u8Path);
            streams.push({
              key: streamKey,
              url: `/live/${streamKey}/index.m3u8`,
              lastModified: stats.mtime,
              size: stats.size
            });
          }
        });
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, streams, count: streams.length }));
      
    } catch (error) {
      console.error('Erreur stats streams:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Erreur serveur' }));
    }
    return;
  }

  // API pour lister les streams disponibles
  if (req.url === '/api/streams' && req.method === 'GET') {
    try {
      const liveDir = join(mediaDir, 'live');
      if (!fs.existsSync(liveDir)) {
        fs.mkdirSync(liveDir, { recursive: true });
      }
      
      const streams = [];
      const streamDirs = fs.readdirSync(liveDir);
      
      streamDirs.forEach(streamKey => {
        const streamPath = join(liveDir, streamKey);
        const m3u8Path = join(streamPath, 'index.m3u8');
        
        if (fs.existsSync(m3u8Path)) {
          streams.push({
            key: streamKey,
            url: `/live/${streamKey}/index.m3u8`,
            hasM3U8: true
          });
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, streams }));
      
    } catch (error) {
      console.error('Erreur liste streams:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Erreur serveur' }));
    }
    return;
  }
  // Servir les fichiers statiques du dossier media
  const filePath = join(mediaDir, req.url.slice(1));
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = filePath.split('.').pop();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case 'mp4': contentType = 'video/mp4'; break;
      case 'm3u8': contentType = 'application/vnd.apple.mpegurl'; break;
      case 'ts': contentType = 'video/mp2t'; break;
      case 'html': contentType = 'text/html'; break;
      case 'js': contentType = 'application/javascript'; break;
      case 'css': contentType = 'text/css'; break;
    }
    
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
});

const PORT = 8000;
server.listen(PORT, () => {
  console.log('🌐 [Simple Media Server] Serveur HTTP démarré sur le port', PORT);
  console.log('📺 [Simple Media Server] Accès: http://localhost:' + PORT);
  console.log('📊 [Simple Media Server] Status: http://localhost:' + PORT + '/status');
  console.log('');
  console.log('✅ Serveur média simplifié prêt !');
});

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du serveur média...');
  server.close(() => {
    console.log('✅ Serveur média arrêté');
    process.exit(0);
  });
});

export default server;