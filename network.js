// ══════════════════════════════════════════════════════════
// network.js — DeutschBattle multiplayer via PeerJS
// Handles: Friends Room (PIN) + Public Lobby (PUBG style)
// ══════════════════════════════════════════════════════════

const Network = (() => {

  // ── State ──────────────────────────────────────────────
  let peer = null;           // our PeerJS instance
  let connections = [];      // active DataConnections (we are host)
  let hostConn = null;       // DataConnection to host (we are guest)
  let isHost = false;
  let roomPIN = null;
  let myUsername = '';
  let myLevel = '';
  let myFlag = '🏳';
  let onGameStart = null;    // callback(players[])
  let onOpponentAnswer = null; // callback(data)
  let onOpponentDisconnect = null;
  let lobbyCheckInterval = null;
  let lobbyPlayers = [];     // host-side list [{id, username, flag}]

  // ── Country flags by common name patterns ─────────────
  const FLAG_MAP = {
    'de':'🇩🇪','at':'🇦🇹','ch':'🇨🇭',
    'in':'🇮🇳','uk':'🇬🇧','gb':'🇬🇧',
    'us':'🇺🇸','tr':'🇹🇷','ua':'🇺🇦',
    'pl':'🇵🇱','id':'🇮🇩','ae':'🇦🇪','az':'🇦🇿'
  };

  // ── Helpers ────────────────────────────────────────────
  function generatePIN() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // PeerJS peer ID for a room host = "db-room-XXXX"
  function roomPeerID(pin) { return 'db-room-' + pin; }

  // PeerJS peer ID for a public lobby host = "db-pub-LEVEL"
  function pubPeerID(level) { return 'db-pub-' + level.replace('.',''); }

  function initPeer(id) {
    return new Promise((resolve, reject) => {
      const p = new Peer(id, { debug: 0 });
      p.on('open', () => resolve(p));
      p.on('error', err => {
        // ID taken = someone else is already host for this room/lobby
        reject(err);
      });
    });
  }

  function sendToAll(data) {
    connections.forEach(c => { try { c.send(data); } catch(e){} });
  }

  function sendToHost(data) {
    try { hostConn.send(data); } catch(e) {}
  }

  // ── Disconnect & cleanup ───────────────────────────────
  function disconnect() {
    clearInterval(lobbyCheckInterval);
    connections.forEach(c => { try { c.close(); } catch(e){} });
    connections = [];
    if (hostConn) { try { hostConn.close(); } catch(e){} hostConn = null; }
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    isHost = false;
    roomPIN = null;
    lobbyPlayers = [];
  }

  // ══════════════════════════════════════════════════════
  // FRIENDS ROOM — HOST
  // ══════════════════════════════════════════════════════
  async function createRoom(username, level, flag, callbacks) {
    disconnect();
    myUsername = username;
    myLevel = level;
    myFlag = flag || '🏳';
    onGameStart = callbacks.onGameStart;
    onOpponentAnswer = callbacks.onOpponentAnswer;
    onOpponentDisconnect = callbacks.onOpponentDisconnect;

    const pin = generatePIN();
    roomPIN = pin;
    isHost = true;

    try {
      peer = await initPeer(roomPeerID(pin));
    } catch(e) {
      // PIN collision (rare) — try again with new PIN
      const pin2 = generatePIN();
      roomPN = pin2;
      peer = await initPeer(roomPeerID(pin2));
      roomPin = pin2;
    }

    peer.on('connection', conn => {
      setupGuestConnection(conn, 'friends');
    });

    peer.on('error', err => {
      console.warn('PeerJS error:', err);
    });

    return pin;
  }

  // ══════════════════════════════════════════════════════
  // FRIENDS ROOM — GUEST
  // ══════════════════════════════════════════════════════
  async function joinRoom(pin, username, level, flag, callbacks) {
    disconnect();
    myUsername = username;
    myLevel = level;
    myFlag = flag || '🏳';
    onGameStart = callbacks.onGameStart;
    onOpponentAnswer = callbacks.onOpponentAnswer;
    onOpponentDisconnect = callbacks.onOpponentDisconnect;
    isHost = false;

    peer = await initPeer(undefined); // random ID for guest

    return new Promise((resolve, reject) => {
      const conn = peer.connect(roomPeerID(pin), { reliable: true });

      const timeout = setTimeout(() => {
        reject(new Error('Room not found. Check the PIN and try again.'));
      }, 8000);

      conn.on('open', () => {
        clearTimeout(timeout);
        hostConn = conn;

        // Introduce ourselves to host
        conn.send({ type: 'JOIN', username: myUsername, flag: myFlag, level: myLevel });

        conn.on('data', data => handleGuestMessage(data));
        conn.on('close', () => {
          if (onOpponentDisconnect) onOpponentDisconnect();
        });
        conn.on('error', () => {
          if (onOpponentDisconnect) onOpponentDisconnect();
        });

        resolve(conn);
      });

      conn.on('error', err => {
        clearTimeout(timeout);
        reject(new Error('Could not connect. Check the PIN and try again.'));
      });
    });
  }

  // ══════════════════════════════════════════════════════
  // PUBLIC LOBBY — HOST
  // Creates or takes over a public lobby for this level
  // ══════════════════════════════════════════════════════
  async function joinPublicLobby(username, level, flag, maxPlayers, callbacks) {
    disconnect();
    myUsername = username;
    myLevel = level;
    myFlag = flag || '🏳';
    onGameStart = callbacks.onGameStart;
    onOpponentAnswer = callbacks.onOpponentAnswer;
    onOpponentDisconnect = callbacks.onOpponentDisconnect;

    // Try to become the public lobby host for this level
    try {
      peer = await initPeer(pubPeerID(level));
      // We got the host ID — we ARE the lobby host
      isHost = true;
      lobbyPlayers = [{ id: peer.id, username: myUsername, flag: myFlag, isMe: true }];

      peer.on('connection', conn => {
        setupGuestConnection(conn, 'public');
      });

      peer.on('error', err => console.warn('Host error:', err));

      // Start lobby countdown — fill with bots after 20s if not full
      startLobbyCountdown(maxPlayers, callbacks.onLobbyUpdate);
      callbacks.onLobbyUpdate(lobbyPlayers);

    } catch(e) {
      // Lobby host already exists — join as guest
      isHost = false;
      peer = await initPeer(undefined);

      const conn = peer.connect(pubPeerID(level), { reliable: true });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Could not find a public lobby. Please try again.'));
        }, 8000);

        conn.on('open', () => {
          clearTimeout(timeout);
          hostConn = conn;
          conn.send({ type: 'JOIN', username: myUsername, flag: myFlag, level: myLevel });
          conn.on('data', data => handleGuestMessage(data));
          conn.on('close', () => { if (onOpponentDisconnect) onOpponentDisconnect(); });
          resolve(conn);
        });

        conn.on('error', err => {
          clearTimeout(timeout);
          reject(new Error('Lobby no longer available. Try again.'));
        });
      });
    }
  }

  // ── Lobby countdown (host side) ────────────────────────
  function startLobbyCountdown(maxPlayers, onLobbyUpdate) {
    let elapsed = 0;
    const WAIT_TIME = 20; // seconds to wait for real players

    lobbyCheckInterval = setInterval(() => {
      elapsed++;

      if (elapsed >= WAIT_TIME || lobbyPlayers.length >= maxPlayers) {
        clearInterval(lobbyCheckInterval);
        // Fill remaining slots with bots
        fillWithBots(maxPlayers);
        // Launch game for everyone
        launchLobbyGame(onLobbyUpdate);
      } else {
        // Broadcast updated lobby to all guests
        sendToAll({ type: 'LOBBY_UPDATE', players: lobbyPlayers });
        if (onLobbyUpdate) onLobbyUpdate([...lobbyPlayers]);
      }
    }, 1000);
  }

  function fillWithBots(maxPlayers) {
    const BOTS = window.BOT_POOL || [];
    const usedBots = new Set(lobbyPlayers.map(p => p.username));
    let pool = BOTS.filter(b => !usedBots.has(b.name));
    // Shuffle
    pool = pool.sort(() => Math.random() - 0.5);

    while (lobbyPlayers.length < maxPlayers && pool.length > 0) {
      const bot = pool.shift();
      lobbyPlayers.push({
        id: 'bot-' + bot.name,
        username: bot.name,
        flag: bot.flag,
        isBot: true,
        botConfig: bot
      });
    }
  }

  function launchLobbyGame(onLobbyUpdate) {
    if (onLobbyUpdate) onLobbyUpdate([...lobbyPlayers]);
    sendToAll({ type: 'GAME_START', players: lobbyPlayers });
    if (onGameStart) onGameStart(lobbyPlayers);
  }

  // ══════════════════════════════════════════════════════
  // CONNECTION HANDLERS (Host side)
  // ══════════════════════════════════════════════════════
  function setupGuestConnection(conn, mode) {
    conn.on('open', () => {
      connections.push(conn);

      conn.on('data', data => {
        if (data.type === 'JOIN') {
          // Register player in lobby
          lobbyPlayers.push({
            id: conn.peer,
            username: data.username,
            flag: data.flag,
            isBot: false
          });

          // Acknowledge join
          conn.send({ type: 'JOIN_ACK', players: lobbyPlayers });

          // Broadcast updated lobby to everyone
          sendToAll({ type: 'LOBBY_UPDATE', players: lobbyPlayers });

          // For friends room: start immediately when 2nd player joins
          if (mode === 'friends' && lobbyPlayers.length >= 2) {
            clearInterval(lobbyCheckInterval);
            const players = [
              { id: peer.id, username: myUsername, flag: myFlag, isMe: true },
              ...connections.map((c, i) => ({
                id: c.peer,
                username: lobbyPlayers[i + 1]?.username || 'Guest',
                flag: lobbyPlayers[i + 1]?.flag || '🏳'
              }))
            ];
            sendToAll({ type: 'GAME_START', players });
            if (onGameStart) onGameStart(players);
          }

        } else if (data.type === 'ANSWER') {
          // Guest submitted an answer — relay to game engine
          if (onOpponentAnswer) onOpponentAnswer({ ...data, fromId: conn.peer });

        } else if (data.type === 'REMATCH_ACCEPT') {
          sendToAll({ type: 'REMATCH_START' });
        }
      });

      conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        lobbyPlayers = lobbyPlayers.filter(p => p.id !== conn.peer);
        sendToAll({ type: 'PLAYER_LEFT', id: conn.peer });
        if (onOpponentDisconnect) onOpponentDisconnect(conn.peer);
      });
    });
  }

  // ══════════════════════════════════════════════════════
  // MESSAGE HANDLER (Guest side)
  // ══════════════════════════════════════════════════════
  function handleGuestMessage(data) {
    switch(data.type) {
      case 'JOIN_ACK':
        // We're in the lobby
        break;

      case 'LOBBY_UPDATE':
        if (window.onLobbyUpdate) window.onLobbyUpdate(data.players);
        break;

      case 'GAME_START':
        if (onGameStart) onGameStart(data.players);
        break;

      case 'ANSWER':
        // Host is relaying another player's answer
        if (onOpponentAnswer) onOpponentAnswer(data);
        break;

      case 'PLAYER_LEFT':
        if (onOpponentDisconnect) onOpponentDisconnect(data.id);
        break;

      case 'REMATCH_START':
        if (window.onRematchStart) window.onRematchStart();
        break;
    }
  }

  // ══════════════════════════════════════════════════════
  // SEND ANSWER (called by game engine when player answers)
  // ══════════════════════════════════════════════════════
  function sendAnswer(answerIdx, timeRemaining) {
    const data = {
      type: 'ANSWER',
      answerIdx,
      timeRemaining,
      username: myUsername,
      flag: myFlag
    };
    if (isHost) {
      // Host broadcasts to all guests
      sendToAll(data);
    } else {
      // Guest sends to host, host relays
      sendToHost(data);
    }
  }

  function sendRematchAccept() {
    if (isHost) {
      sendToAll({ type: 'REMATCH_START' });
    } else {
      sendToHost({ type: 'REMATCH_ACCEPT' });
    }
  }

  // ══════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════
  return {
    createRoom,
    joinRoom,
    joinPublicLobby,
    sendAnswer,
    sendRematchAccept,
    disconnect,
    getIsHost: () => isHost,
    getRoomPIN: () => roomPN,
    getMyUsername: () => myUsername
  };

})();
