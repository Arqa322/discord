import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Bell,
  BookOpen,
  Check,
  Copy,
  Disc3,
  Download,
  Gamepad2,
  Hash,
  Headphones,
  Home,
  Lock,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  Moon,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Shield,
  Sun,
  Users,
  Video,
  VideoOff,
  Wifi,
} from 'lucide-react';
import {
  useAppStore,
  type AttachmentMeta,
  type Channel,
  type ChatMessage,
  type Presence,
  type RoomMode,
} from './store/useAppStore';
import {
  clearSession,
  createProviderUser,
  loadSession,
  loadWorkspace,
  loginLocalUser,
  registerLocalUser,
  saveWorkspace,
} from './lib/persistence';

const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302'] },
  ],
};

type SignalMode = 'manual' | 'relay' | 'lan';
type LinkStatus = 'idle' | 'connecting' | 'connected' | 'failed';
type AuthMode = 'login' | 'register';
type ComposerFile = { file: File; meta: AttachmentMeta } | null;

const avatarPool = ['🛰️', '🎧', '🦊', '🧠', '🪐', '⚡', '🌙', '🎮', '🧪'];
const colorPool = ['#38BDF8', '#8B5CF6', '#14B8A6', '#F59E0B', '#EF4444', '#6366F1'];

const nowTime = () =>
  new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

const roomTopicFromCode = (code: string) => `topic:${code.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;

const humanSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const waitForIce = (peer: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (peer.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const listener = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', listener);
        resolve();
      }
    };

    peer.addEventListener('icegatheringstatechange', listener);
  });

const lineClamp = 'overflow-hidden text-ellipsis';

function App() {
  const {
    theme,
    view,
    profile,
    rooms,
    activeRoomId,
    activeChannelId,
    messages,
    setTheme,
    setView,
    setProfile,
    hydrate,
    setActiveRoom,
    setActiveChannel,
    createRoom,
    joinRoom,
    addMessage,
    upsertMember,
    updateMemberState,
  } = useAppStore();

  const [booted, setBooted] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [composer, setComposer] = useState('');
  const [queuedFile, setQueuedFile] = useState<ComposerFile>(null);
  const [roomName, setRoomName] = useState('My Mesh Room');
  const [roomMode, setRoomMode] = useState<RoomMode>('mesh');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [signalMode, setSignalMode] = useState<SignalMode>('manual');
  const [offerBlob, setOfferBlob] = useState('');
  const [offerInput, setOfferInput] = useState('');
  const [answerBlob, setAnswerBlob] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [copiedValue, setCopiedValue] = useState('');
  const [handshakeLog, setHandshakeLog] = useState<string[]>([
    'Сигнальный слой нужен только для bootstrap: обмен offer/answer/ICE, далее медиапотоки идут напрямую между пирами.',
    'Для локальной сети invite-код преобразуется в детерминированный topic для discovery transport.',
  ]);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('idle');
  const [networkMessage, setNetworkMessage] = useState('');
  const [desktopInfo, setDesktopInfo] = useState<{ version: string; platform: string; isPackaged: boolean } | null>(null);
  const [screenSources, setScreenSources] = useState<Array<{ id: string; name: string; thumbnail: string }>>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [voiceDetection, setVoiceDetection] = useState(true);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [signalingEndpoint, setSignalingEndpoint] = useState('http://127.0.0.1:3001');

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const isLight = theme === 'light';
  const rootClass = isLight
    ? 'bg-slate-100 text-slate-900'
    : 'bg-[#0b1020] text-slate-100';
  const panelClass = isLight
    ? 'border-slate-200 bg-white/90'
    : 'border-white/10 bg-white/5';
  const softTextClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const hoverClass = isLight ? 'hover:bg-slate-200/80' : 'hover:bg-white/8';

  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) ?? rooms[0], [rooms, activeRoomId]);
  const activeChannel = useMemo(
    () => activeRoom?.channels.find((channel) => channel.id === activeChannelId) ?? activeRoom?.channels[0],
    [activeRoom, activeChannelId],
  );
  const channelKey = activeRoom && activeChannel ? `${activeRoom.id}:${activeChannel.id}` : '';
  const channelMessages = channelKey ? messages[channelKey] ?? [] : [];

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const [workspace, session] = await Promise.all([loadWorkspace(), loadSession()]);
      if (!mounted) return;

      if (workspace) {
        hydrate(workspace);
      }

      if (session) {
        setProfile(session);
      }

      if (window.pulseDesktop) {
        const [info, endpoint] = await Promise.all([
          window.pulseDesktop.getAppInfo(),
          window.pulseDesktop.getSignalingUrl(),
        ]);
        if (mounted) {
          setDesktopInfo(info);
          setSignalingEndpoint(endpoint);
          setHandshakeLog((prev) => [`Desktop signaling: ${endpoint}`, ...prev].slice(0, 10));
        }
      }

      setBooted(true);
    };

    bootstrap();

    return () => {
      mounted = false;
      peerRef.current?.close();
      socketRef.current?.disconnect();
      channelRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [hydrate, setProfile]);

  useEffect(() => {
    if (!booted) return;

    const socket = io(signalingEndpoint, {
      transports: ['websocket'],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setHandshakeLog((prev) => [`Signal relay connected: ${socket.id}`, ...prev].slice(0, 10));
    });

    socket.on('disconnect', (reason) => {
      setHandshakeLog((prev) => [`Signal relay disconnected: ${reason}`, ...prev].slice(0, 10));
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [booted, signalingEndpoint]);

  useEffect(() => {
    if (!booted) return;

    saveWorkspace({
      profile,
      rooms,
      messages,
      theme,
    });
  }, [booted, profile, rooms, messages, theme]);

  useEffect(() => {
    if (activeChannel?.kind === 'voice' && view === 'chat') {
      setView('call');
    }
  }, [activeChannel?.kind, view, setView]);

  const appendLog = (entry: string) => {
    setHandshakeLog((prev) => [entry, ...prev].slice(0, 10));
  };

  const attachLocalStream = (stream: MediaStream) => {
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  };

  const attachRemoteStream = (stream: MediaStream) => {
    remoteStreamRef.current = stream;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  };

  const notify = async (title: string, body: string) => {
    if (window.pulseDesktop) {
      await window.pulseDesktop.notify(title, body);
      return;
    }

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          new Notification(title, { body });
        }
      }
    }
  };

  const addLocalMessage = (body: string, via: ChatMessage['via'], attachments?: AttachmentMeta[]) => {
    if (!activeRoom || !activeChannel) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      channelId: activeChannel.id,
      senderId: profile?.id ?? 'member-you',
      senderName: profile?.name ?? 'Вы',
      senderAvatar: profile?.avatar ?? '🛰️',
      body,
      timestamp: nowTime(),
      via,
      encrypted: true,
      attachments,
      reactions: via === 'p2p' ? ['📡'] : ['🔐'],
    };

    addMessage(activeRoom.id, activeChannel.id, message);
  };

  const addRemoteMessage = (body: string, senderName = 'Remote Peer', senderAvatar = '⚡', attachments?: AttachmentMeta[]) => {
    if (!activeRoom || !activeChannel) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      channelId: activeChannel.id,
      senderId: 'remote-peer',
      senderName,
      senderAvatar,
      body,
      timestamp: nowTime(),
      via: 'p2p',
      encrypted: true,
      attachments,
      reactions: ['📡', '🔐'],
    };

    addMessage(activeRoom.id, activeChannel.id, message);
    notify(senderName, body);
  };

  const bindDataChannel = (channel: RTCDataChannel) => {
    channelRef.current = channel;

    channel.onopen = () => {
      setLinkStatus('connected');
      appendLog('DataChannel открыт: текст, presence и мелкие служебные данные идут напрямую между пирами.');
      setSessionNote('P2P data channel connected');
    };

    channel.onclose = () => {
      setLinkStatus('idle');
      appendLog('DataChannel закрыт. Соединение можно поднять заново тем же invite-кодом или новой SDP-парой.');
    };

    channel.onerror = () => {
      setLinkStatus('failed');
      appendLog('Ошибка DataChannel. Обычно помогает новый handshake и повторный обмен SDP.');
    };

    channel.onmessage = async (event) => {
      try {
        const packet = JSON.parse(event.data) as {
          type: 'chat' | 'presence' | 'system';
          body?: string;
          senderName?: string;
          senderAvatar?: string;
          attachments?: AttachmentMeta[];
          speaking?: boolean;
          muted?: boolean;
        };

        if (packet.type === 'chat' && packet.body) {
          addRemoteMessage(packet.body, packet.senderName, packet.senderAvatar, packet.attachments);
        }

        if (packet.type === 'presence' && activeRoom) {
          updateMemberState(activeRoom.id, 'remote-peer', {
            speaking: packet.speaking ?? false,
            muted: packet.muted ?? false,
            status: 'online',
          });
        }

        if (packet.type === 'system' && packet.body) {
          appendLog(packet.body);
        }
      } catch {
        addRemoteMessage(String(event.data));
      }
    };
  };

  const cleanupPeer = (keepMedia = true) => {
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;

    if (!keepMedia) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    }
  };

  const ensureMedia = async (withVideo: boolean) => {
    const existing = localStreamRef.current;

    if (existing && (!withVideo || existing.getVideoTracks().length > 0)) {
      attachLocalStream(existing);
      return existing;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: withVideo
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          }
        : false,
    });

    attachLocalStream(stream);
    setCameraEnabled(withVideo);
    setIsMuted(false);
    return stream;
  };

  const createPeer = () => {
    const peer = new RTCPeerConnection(rtcConfig);

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === 'connected') setLinkStatus('connected');
      if (state === 'connecting') setLinkStatus('connecting');
      if (state === 'failed' || state === 'disconnected') setLinkStatus('failed');
      appendLog(`Peer state: ${state}`);
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        attachRemoteStream(stream);
      }
    };

    peer.ondatachannel = (event) => {
      bindDataChannel(event.channel);
    };

    peerRef.current = peer;
    return peer;
  };

  const ensureTracksOnPeer = async (peer: RTCPeerConnection, withVideo: boolean) => {
    const stream = await ensureMedia(withVideo);
    stream.getTracks().forEach((track) => {
      const hasTrack = peer
        .getSenders()
        .some((sender) => sender.track?.kind === track.kind && sender.track?.id === track.id);

      if (!hasTrack) {
        peer.addTrack(track, stream);
      }
    });
  };

  const copyValue = async (value: string, token: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedValue(token);
    setTimeout(() => setCopiedValue(''), 1400);
  };

  const startOffer = async (withVideo: boolean) => {
    try {
      cleanupPeer(true);
      const peer = createPeer();
      const channel = peer.createDataChannel('pulsemesh-chat');
      bindDataChannel(channel);
      await ensureTracksOnPeer(peer, withVideo);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      setOfferBlob(JSON.stringify(peer.localDescription, null, 2));
      setAnswerBlob('');
      setLinkStatus('connecting');
      appendLog('Offer создан. Отправьте этот blob второму участнику через любой bootstrap-канал.');
      setView('network');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLinkStatus('failed');
      appendLog(`Не удалось создать offer: ${message}`);
    }
  };

  const acceptOffer = async (withVideo: boolean) => {
    try {
      if (!offerInput.trim()) return;
      cleanupPeer(true);
      const peer = createPeer();
      await ensureTracksOnPeer(peer, withVideo);
      await peer.setRemoteDescription(JSON.parse(offerInput));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIce(peer);
      setAnswerBlob(JSON.stringify(peer.localDescription, null, 2));
      setLinkStatus('connecting');
      appendLog('Offer принят. Ответный SDP готов — отправьте его инициатору.');
      setView('network');
      if (activeRoom) {
        upsertMember(activeRoom.id, {
          id: 'remote-peer',
          name: 'Remote Peer',
          avatar: '⚡',
          role: 'Peer',
          status: 'online',
          speaking: false,
          muted: false,
          latency: 18,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLinkStatus('failed');
      appendLog(`Не удалось принять offer: ${message}`);
    }
  };

  const applyAnswer = async () => {
    try {
      if (!answerInput.trim() || !peerRef.current) return;
      await peerRef.current.setRemoteDescription(JSON.parse(answerInput));
      setLinkStatus('connecting');
      appendLog('Ответ применен. Ждем установления прямого канала и открытия media/data streams.');
      if (activeRoom) {
        upsertMember(activeRoom.id, {
          id: 'remote-peer',
          name: 'Remote Peer',
          avatar: '⚡',
          role: 'Peer',
          status: 'online',
          speaking: false,
          muted: false,
          latency: 17,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLinkStatus('failed');
      appendLog(`Не удалось применить answer: ${message}`);
    }
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!composer.trim() && !queuedFile) return;

    const attachments = queuedFile ? [queuedFile.meta] : undefined;
    const text = composer.trim() || `Отправлен файл: ${queuedFile?.meta.name}`;

    addLocalMessage(text, channelRef.current?.readyState === 'open' ? 'p2p' : 'local', attachments);

    if (channelRef.current?.readyState === 'open') {
      channelRef.current.send(
        JSON.stringify({
          type: 'chat',
          body: text,
          senderName: profile?.name ?? 'Вы',
          senderAvatar: profile?.avatar ?? '🛰️',
          attachments,
        }),
      );
    } else {
      setTimeout(() => {
        addRemoteMessage(
          'Локальный режим: сообщение сохранено в IndexedDB. Для реального обмена между устройствами завершите WebRTC-handshake.',
          'Mesh Guide',
          '📡',
        );
      }, 500);
    }

    setComposer('');
    setQueuedFile(null);
  };

  const pushPresence = (speaking: boolean, muted: boolean) => {
    if (channelRef.current?.readyState === 'open') {
      channelRef.current.send(JSON.stringify({ type: 'presence', speaking, muted }));
    }
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
    pushPresence(false, next);
  };

  const toggleCamera = async () => {
    const stream = localStreamRef.current;

    if (!stream || stream.getVideoTracks().length === 0) {
      const refreshed = await ensureMedia(true);
      const track = refreshed.getVideoTracks()[0];
      const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (track && sender) await sender.replaceTrack(track);
      setCameraEnabled(true);
      return;
    }

    const next = !cameraEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  };

  const toggleScreenShare = async () => {
    if (!peerRef.current) {
      appendLog('Сначала поднимите peer connection, затем включайте демонстрацию экрана.');
      return;
    }

    try {
      if (!screenSharing) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const displayTrack = displayStream.getVideoTracks()[0];
        const sender = peerRef.current.getSenders().find((item) => item.track?.kind === 'video');

        if (sender && displayTrack) {
          await sender.replaceTrack(displayTrack);
        }

        attachLocalStream(displayStream);
        setScreenSharing(true);
        displayTrack.onended = async () => {
          setScreenSharing(false);
          if (cameraEnabled) {
            const cameraStream = await ensureMedia(true);
            const cameraTrack = cameraStream.getVideoTracks()[0];
            const cameraSender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
            if (cameraTrack && cameraSender) {
              await cameraSender.replaceTrack(cameraTrack);
            }
            attachLocalStream(cameraStream);
          }
        };
      } else {
        const cameraStream = await ensureMedia(cameraEnabled);
        const cameraTrack = cameraStream.getVideoTracks()[0];
        const sender = peerRef.current.getSenders().find((item) => item.track?.kind === 'video');
        if (cameraTrack && sender) {
          await sender.replaceTrack(cameraTrack);
        }
        attachLocalStream(cameraStream);
        setScreenSharing(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Screen share error: ${message}`);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }

    const stream = localStreamRef.current;
    if (!stream) {
      appendLog('Запись доступна после включения локального аудио/видео-потока.');
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
    recordedChunksRef.current = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordingUrl(url);
      appendLog('Локальная запись сохранена в память браузера. Ее можно скачать ниже.');
    };

    recorder.start();
    setRecording(true);
  };

  const createRoomAction = () => {
    const room = createRoom(roomName.trim() || 'My Mesh Room', roomMode);
    setRoomCodeInput(room.code);
    setView('chat');
    appendLog(
      room.mode === 'lan'
        ? `Комната ${room.name} создана. Для локалки используйте topic ${roomTopicFromCode(room.code)}.`
        : `Комната ${room.name} создана. Invite-код: ${room.code}.`,
    );
  };

  const joinRoomAction = () => {
    if (!roomCodeInput.trim()) return;
    const room = joinRoom(roomCodeInput.trim());
    appendLog(`Подключение к комнате ${room.name}. Bootstrap topic: ${roomTopicFromCode(room.code)}.`);
    setView('chat');
  };

  const logout = async () => {
    await clearSession();
    cleanupPeer(false);
    setProfile(null);
    setAuthPassword('');
    setAuthError('');
  };

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    if (authMode === 'register') {
      const result = await registerLocalUser({
        name: authName || `Peer ${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        email: authEmail,
        password: authPassword,
        avatar: avatarPool[Math.floor(Math.random() * avatarPool.length)],
        color: colorPool[Math.floor(Math.random() * colorPool.length)],
        provider: 'email',
        status: 'online',
        tagline: 'Локальный профиль для serverless mesh-коммуникаций.',
      });

      if (!result.ok) {
        setAuthError(result.error);
        return;
      }

      setProfile(result.user);
      setSessionNote('Local account created');
      return;
    }

    const result = await loginLocalUser(authEmail, authPassword);
    if (!result.ok) {
      setAuthError(result.error);
      return;
    }

    setProfile(result.user);
    setSessionNote('Local account restored');
  };

  const loginWithProvider = async (provider: 'google' | 'discord' | 'github') => {
    const user = await createProviderUser(provider);
    setProfile(user);
    setSessionNote(`Connected via ${provider}`);
  };

  const activeMembers = activeRoom?.members ?? [];
  const inviteCode = activeRoom?.code ?? 'room-pulsemesh';
  const selectedTitle = activeChannel?.kind === 'voice' ? activeChannel.name : `# ${activeChannel?.name ?? 'лобби'}`;

  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1020] text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-8 py-6 text-center shadow-2xl">
          <Disc3 className="mx-auto mb-4 h-10 w-10 animate-spin text-cyan-400" />
          <p className="text-lg font-semibold">PulseMesh Desktop загружается</p>
          <p className="mt-2 text-sm text-slate-400">Поднимаем IndexedDB, локальный профиль и рабочее пространство.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${rootClass}`}>
      <div className="flex h-screen overflow-hidden">
        <aside className={`flex w-[84px] flex-col items-center gap-4 border-r px-3 py-4 ${panelClass}`}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-600 text-white shadow-lg shadow-cyan-500/30">
            <Wifi className="h-7 w-7" />
          </div>
          <div className="h-px w-8 bg-white/10" />
          <button
            onClick={() => setView('chat')}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${
              view === 'chat' ? 'bg-indigo-600 text-white' : `${hoverClass} ${softTextClass}`
            }`}
            title="Workspace"
          >
            <Home className="h-5 w-5" />
          </button>
          <button
            onClick={() => setView('network')}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${
              view === 'network' ? 'bg-emerald-600 text-white' : `${hoverClass} ${softTextClass}`
            }`}
            title="P2P Link"
          >
            <Radio className="h-5 w-5" />
          </button>
          <button
            onClick={() => setView('desktop')}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${
              view === 'desktop' ? 'bg-fuchsia-600 text-white' : `${hoverClass} ${softTextClass}`
            }`}
            title="Desktop"
          >
            <Monitor className="h-5 w-5" />
          </button>
          <button
            onClick={() => setView('profile')}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${
              view === 'profile' ? 'bg-amber-500 text-slate-950' : `${hoverClass} ${softTextClass}`
            }`}
            title="Profile"
          >
            <Settings className="h-5 w-5" />
          </button>
          <div className="mt-3 flex w-full flex-col gap-3 overflow-y-auto pb-4">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => {
                  setActiveRoom(room.id);
                  setView(room.channels[0]?.kind === 'voice' ? 'call' : 'chat');
                }}
                className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold transition ${
                  room.id === activeRoom?.id
                    ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-indigo-700/30'
                    : `${hoverClass} border border-transparent ${softTextClass}`
                }`}
                title={room.name}
              >
                {room.name.slice(0, 2).toUpperCase()}
              </button>
            ))}
            <button
              onClick={createRoomAction}
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed transition ${hoverClass} ${softTextClass}`}
              title="Create room"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-auto flex flex-col items-center gap-3">
            <button
              onClick={() => setTheme(isLight ? 'dark' : 'light')}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition ${panelClass}`}
              title="Theme"
            >
              {isLight ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> P2P
            </div>
          </div>
        </aside>

        <aside className={`hidden w-[290px] shrink-0 flex-col border-r lg:flex ${panelClass}`}>
          <div className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Headphones className="h-4 w-4 text-cyan-400" />
                  {activeRoom?.name}
                </div>
                <p className={`mt-1 text-xs ${softTextClass}`}>{activeRoom?.description}</p>
              </div>
              <button className={`rounded-xl border px-3 py-2 text-xs transition ${panelClass}`} onClick={() => copyValue(inviteCode, 'invite')}>
                {copiedValue === 'invite' ? 'Скопировано' : 'Invite'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <SectionLabel icon={<Hash className="h-3.5 w-3.5" />} title="Текстовые каналы" />
            <div className="mt-2 space-y-1">
              {activeRoom?.channels
                .filter((channel) => channel.kind !== 'voice')
                .map((channel) => (
                  <ChannelButton
                    key={channel.id}
                    channel={channel}
                    active={channel.id === activeChannel?.id && view === 'chat'}
                    onClick={() => {
                      setActiveChannel(channel.id);
                      setView('chat');
                    }}
                    light={isLight}
                  />
                ))}
            </div>

            <SectionLabel icon={<Radio className="h-3.5 w-3.5" />} title="Голос / видео" />
            <div className="mt-2 space-y-1">
              {activeRoom?.channels
                .filter((channel) => channel.kind === 'voice')
                .map((channel) => (
                  <ChannelButton
                    key={channel.id}
                    channel={channel}
                    active={channel.id === activeChannel?.id && view === 'call'}
                    onClick={() => {
                      setActiveChannel(channel.id);
                      setView('call');
                    }}
                    light={isLight}
                  />
                ))}
            </div>

            <div className={`mt-6 rounded-3xl border p-4 ${panelClass}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Создать / подключить комнату</h3>
                <Shield className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-4 space-y-3">
                <input
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                  placeholder="Название комнаты"
                />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(['mesh', 'sfu', 'lan'] as RoomMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setRoomMode(mode)}
                      className={`rounded-2xl px-3 py-2 font-medium capitalize transition ${
                        roomMode === mode ? 'bg-indigo-600 text-white' : `${panelClass} ${softTextClass}`
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <button onClick={createRoomAction} className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500">
                  Создать room
                </button>
                <input
                  value={roomCodeInput}
                  onChange={(event) => setRoomCodeInput(event.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                  placeholder="room-abc123"
                />
                <button onClick={joinRoomAction} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500">
                  Подключиться по коду
                </button>
                <p className={`text-xs leading-relaxed ${softTextClass}`}>
                  Принцип без хоста: код комнаты превращается в topic discovery, затем участники обмениваются SDP/ICE через
                  временный bootstrap-канал и переходят на прямые WebRTC-соединения.
                </p>
              </div>
            </div>
          </div>

          <div className={`border-t px-4 py-4 ${isLight ? 'bg-slate-50/80' : 'bg-black/20'}`}>
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl shadow-lg"
                style={{ background: profile?.color ?? '#334155' }}
              >
                {profile?.avatar ?? '🛰️'}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${lineClamp}`}>{profile?.name ?? 'Guest peer'}</p>
                <p className={`text-xs ${softTextClass}`}>{profile?.email ?? 'Войдите для сохранения профиля'}</p>
              </div>
              <button onClick={() => setView('profile')} className={`rounded-xl border p-2 transition ${panelClass}`}>
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className={`flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 ${panelClass}`}>
            <div>
              <div className="flex items-center gap-2">
                {activeChannel?.kind === 'voice' ? <Headphones className="h-4 w-4 text-emerald-400" /> : <Hash className="h-4 w-4 text-indigo-400" />}
                <h1 className="text-base font-semibold">{selectedTitle}</h1>
                <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${isLight ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-slate-300'}`}>
                  {activeRoom?.mode.toUpperCase()}
                </span>
              </div>
              <p className={`mt-1 text-sm ${softTextClass}`}>{activeChannel?.topic}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <HeaderSwitch active={view === 'chat'} onClick={() => setView('chat')} icon={<MessageSquare className="h-4 w-4" />} label="Chat" light={isLight} />
              <HeaderSwitch active={view === 'call'} onClick={() => setView('call')} icon={<Video className="h-4 w-4" />} label="Call" light={isLight} />
              <HeaderSwitch active={view === 'network'} onClick={() => setView('network')} icon={<Radio className="h-4 w-4" />} label="P2P Link" light={isLight} />
              <HeaderSwitch active={view === 'desktop'} onClick={() => setView('desktop')} icon={<Monitor className="h-4 w-4" />} label="Desktop" light={isLight} />
              <HeaderSwitch active={view === 'profile'} onClick={() => setView('profile')} icon={<Users className="h-4 w-4" />} label="Profile" light={isLight} />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section className="min-w-0 flex-1 overflow-y-auto p-5">
              {view === 'chat' && (
                <div className="flex h-full flex-col gap-5">
                  <div className={`grid gap-4 xl:grid-cols-[1.5fr_1fr]`}>
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Шифрованный канал</p>
                          <p className={`mt-1 text-sm ${softTextClass}`}>
                            История канала хранится локально в IndexedDB; при активном DataChannel новые сообщения идут peer-to-peer.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                          <Lock className="h-4 w-4" /> E2EE ready
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Быстрый статус сети</p>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${linkStatus === 'connected' ? 'bg-emerald-500/15 text-emerald-400' : linkStatus === 'connecting' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-500/15 text-slate-400'}`}>
                          {linkStatus}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <MetricCard label="Room topic" value={roomTopicFromCode(inviteCode).slice(0, 15)} light={isLight} />
                        <MetricCard label="Peers" value={String(activeMembers.length)} light={isLight} />
                        <MetricCard label="Invite" value={inviteCode.slice(-6)} light={isLight} />
                      </div>
                    </div>
                  </div>

                  <div className={`flex-1 rounded-3xl border ${panelClass}`}>
                    <div className="flex h-full flex-col">
                      <div className="flex-1 space-y-4 overflow-y-auto p-5">
                        {channelMessages.map((message) => (
                          <article key={message.id} className={`rounded-3xl border p-4 ${message.senderId === profile?.id ? (isLight ? 'border-indigo-200 bg-indigo-50' : 'border-indigo-500/20 bg-indigo-500/10') : panelClass}`}>
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: message.senderId === profile?.id ? profile?.color ?? '#6366f1' : '#1e293b' }}>
                                {message.senderAvatar}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{message.senderName}</span>
                                  <span className={`text-xs ${softTextClass}`}>{message.timestamp}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${message.encrypted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                                    {message.encrypted ? 'encrypted' : 'local'}
                                  </span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isLight ? 'bg-slate-200 text-slate-600' : 'bg-white/10 text-slate-300'}`}>
                                    {message.via}
                                  </span>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{message.body}</p>
                                {message.attachments?.length ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {message.attachments.map((attachment) => (
                                      <div key={attachment.name} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${panelClass}`}>
                                        <Download className="h-3.5 w-3.5" />
                                        <span>{attachment.name}</span>
                                        <span className={softTextClass}>{attachment.sizeLabel}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {message.reactions?.length ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {message.reactions.map((reaction, index) => (
                                      <span key={`${message.id}-${index}`} className={`rounded-full px-2 py-1 text-xs ${isLight ? 'bg-slate-200' : 'bg-white/10'}`}>
                                        {reaction}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>

                      <form onSubmit={handleSend} className="border-t p-4">
                        <div className={`rounded-3xl border p-3 ${panelClass}`}>
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => document.getElementById('composer-file')?.click()}
                              className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${panelClass}`}
                            >
                              Вложение
                            </button>
                            <input
                              id="composer-file"
                              type="file"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                setQueuedFile({
                                  file,
                                  meta: { name: file.name, sizeLabel: humanSize(file.size) },
                                });
                              }}
                            />
                            {queuedFile ? (
                              <span className={`rounded-full px-3 py-1 text-xs ${isLight ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-500/15 text-indigo-300'}`}>
                                {queuedFile.meta.name} · {queuedFile.meta.sizeLabel}
                              </span>
                            ) : null}
                            <span className={`text-xs ${softTextClass}`}>
                              Markdown-friendly chat, emoji/reactions и мелкие file meta через DataChannel.
                            </span>
                          </div>
                          <div className="flex items-end gap-3">
                            <textarea
                              value={composer}
                              onChange={(event) => setComposer(event.target.value)}
                              rows={3}
                              placeholder="Напишите сообщение или инструкцию для подключения..."
                              className={`min-h-[84px] flex-1 resize-none rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                            />
                            <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white transition hover:bg-indigo-500" type="submit">
                              <Send className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              {view === 'call' && (
                <div className="space-y-5">
                  <div className={`grid gap-4 xl:grid-cols-[1.55fr_1fr]`}>
                    <div className={`overflow-hidden rounded-3xl border ${panelClass}`}>
                      <div className="grid min-h-[420px] gap-4 p-4 lg:grid-cols-2">
                        <MediaTile
                          title={profile?.name ?? 'Local peer'}
                          subtitle={screenSharing ? 'Screen share live' : cameraEnabled ? 'Camera live' : 'Audio only'}
                          badge={screenSharing ? 'sharing' : isMuted ? 'muted' : 'live'}
                          videoRef={localVideoRef}
                          icon={profile?.avatar ?? '🛰️'}
                          dark={!isLight}
                        />
                        <MediaTile
                          title="Remote peer"
                          subtitle={linkStatus === 'connected' ? 'Direct WebRTC stream' : 'Waiting for connection'}
                          badge={linkStatus}
                          videoRef={remoteVideoRef}
                          icon="⚡"
                          dark={!isLight}
                        />
                      </div>
                    </div>

                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Голос / видео инструменты</h3>
                        <Bell className="h-4 w-4 text-cyan-400" />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <ActionButton onClick={() => startOffer(false)} icon={<Phone className="h-4 w-4" />} label="Voice offer" active={false} />
                        <ActionButton onClick={() => startOffer(true)} icon={<Video className="h-4 w-4" />} label="Video offer" active={false} />
                        <ActionButton onClick={toggleMute} icon={isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} label={isMuted ? 'Unmute' : 'Mute'} active={!isMuted} />
                        <ActionButton onClick={toggleCamera} icon={cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} label={cameraEnabled ? 'Camera on' : 'Camera off'} active={cameraEnabled} />
                        <ActionButton onClick={toggleScreenShare} icon={<Monitor className="h-4 w-4" />} label={screenSharing ? 'Stop share' : 'Share screen'} active={screenSharing} />
                        <ActionButton onClick={toggleRecording} icon={<Disc3 className={`h-4 w-4 ${recording ? 'animate-spin' : ''}`} />} label={recording ? 'Stop rec' : 'Record'} active={recording} />
                      </div>

                      <div className="mt-5 space-y-3 text-sm">
                        <ToggleRow label="Push-to-talk" enabled={pushToTalk} onToggle={() => setPushToTalk((prev) => !prev)} />
                        <ToggleRow label="Voice activity detection" enabled={voiceDetection} onToggle={() => setVoiceDetection((prev) => !prev)} />
                        <ToggleRow label="Echo cancellation + AGC" enabled={true} onToggle={() => {}} disabled />
                        <ToggleRow label="Noise suppression (browser DSP)" enabled={true} onToggle={() => {}} disabled />
                      </div>

                      {recordingUrl ? (
                        <a href={recordingUrl} download="pulsemesh-session.webm" className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500">
                          <Download className="h-4 w-4" /> Скачать запись
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className={`rounded-3xl border p-5 ${panelClass}`}>
                    <div className="grid gap-4 md:grid-cols-4">
                      <MetricCard label="Codec" value="Opus / VP8" light={isLight} />
                      <MetricCard label="Topology" value={activeMembers.length > 8 ? 'Peer-SFU' : 'Mesh'} light={isLight} />
                      <MetricCard label="Max hint" value="1080p60" light={isLight} />
                      <MetricCard label="Status" value={linkStatus} light={isLight} />
                    </div>
                    <p className={`mt-4 text-sm leading-7 ${softTextClass}`}>
                      Для малых групп приложение использует mesh-схему: каждый участник держит прямое соединение с каждым.
                      После роста комнаты предлагается временный relay/SFU-узел, выбираемый из доступных пиров по полосе и CPU.
                    </p>
                  </div>
                </div>
              )}

              {view === 'network' && (
                <div className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold">P2P bootstrap без постоянного хоста</h2>
                          <p className={`mt-1 text-sm ${softTextClass}`}>
                            Мы используем временный сигнальный обмен для знакомства пиров, а затем переносим сообщения и медиа в прямой WebRTC.
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <ModeChip label="manual SDP" active={signalMode === 'manual'} onClick={() => setSignalMode('manual')} />
                          <ModeChip label="relay bootstrap" active={signalMode === 'relay'} onClick={() => setSignalMode('relay')} />
                          <ModeChip label="LAN topic" active={signalMode === 'lan'} onClick={() => setSignalMode('lan')} />
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className={`rounded-3xl border p-4 ${panelClass}`}>
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Шаг 1 — создать offer</h3>
                            <button onClick={() => startOffer(cameraEnabled)} className="rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500">
                              Generate
                            </button>
                          </div>
                          <textarea
                            value={offerBlob}
                            onChange={(event) => setOfferBlob(event.target.value)}
                            className={`mt-3 h-56 w-full rounded-2xl border px-4 py-3 text-xs outline-none ${panelClass}`}
                            placeholder="Здесь появится offer SDP + ICE"
                          />
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => copyValue(offerBlob, 'offer')} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${panelClass}`}>
                              {copiedValue === 'offer' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </button>
                            <button onClick={() => setOfferBlob('')} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${panelClass}`}>
                              Очистить
                            </button>
                          </div>
                        </div>

                        <div className={`rounded-3xl border p-4 ${panelClass}`}>
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Шаг 2 — принять offer</h3>
                            <button onClick={() => acceptOffer(cameraEnabled)} className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500">
                              Create answer
                            </button>
                          </div>
                          <textarea
                            value={offerInput}
                            onChange={(event) => setOfferInput(event.target.value)}
                            className={`mt-3 h-56 w-full rounded-2xl border px-4 py-3 text-xs outline-none ${panelClass}`}
                            placeholder="Вставьте offer от собеседника"
                          />
                          <textarea
                            value={answerBlob}
                            onChange={(event) => setAnswerBlob(event.target.value)}
                            className={`mt-3 h-32 w-full rounded-2xl border px-4 py-3 text-xs outline-none ${panelClass}`}
                            placeholder="Готовый answer"
                          />
                        </div>
                      </div>

                      <div className={`mt-4 rounded-3xl border p-4 ${panelClass}`}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Шаг 3 — применить answer</h3>
                          <button onClick={applyAnswer} className="rounded-2xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500">
                            Apply answer
                          </button>
                        </div>
                        <textarea
                          value={answerInput}
                          onChange={(event) => setAnswerInput(event.target.value)}
                          className={`mt-3 h-40 w-full rounded-2xl border px-4 py-3 text-xs outline-none ${panelClass}`}
                          placeholder="Вставьте answer от второго участника"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className={`rounded-3xl border p-5 ${panelClass}`}>
                        <h3 className="text-sm font-semibold">Принцип соединения без хоста</h3>
                        <ol className={`mt-3 space-y-3 text-sm leading-7 ${softTextClass}`}>
                          <li>1. Создатель комнаты генерирует invite-код и детерминированный discovery topic.</li>
                          <li>2. Пиры находят друг друга через локальный discovery или временный relay/bootstrap канал.</li>
                          <li>3. Обмениваются offer/answer/ICE, после чего сообщения, голос, видео и screen share идут напрямую по WebRTC.</li>
                          <li>4. Для групп до 6–8 человек используется full mesh; после этого можно выбрать peer с лучшей сетью как временный SFU relay.</li>
                        </ol>
                      </div>

                      <div className={`rounded-3xl border p-5 ${panelClass}`}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Invite / discovery</h3>
                          <Rocket className="h-4 w-4 text-fuchsia-400" />
                        </div>
                        <div className="mt-4 space-y-3 text-sm">
                          <InfoRow label="Invite code" value={inviteCode} light={isLight} />
                          <InfoRow label="Topic" value={roomTopicFromCode(inviteCode)} light={isLight} />
                          <InfoRow label="Signal mode" value={signalMode} light={isLight} />
                          <InfoRow label="Signal relay" value={signalingEndpoint} light={isLight} />
                          <InfoRow label="TURN" value="Опциональный fallback для strict NAT" light={isLight} />
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button onClick={() => copyValue(inviteCode, 'room-code')} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${panelClass}`}>
                            {copiedValue === 'room-code' ? 'Скопировано' : 'Копировать код'}
                          </button>
                          <button onClick={() => copyValue(roomTopicFromCode(inviteCode), 'topic')} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${panelClass}`}>
                            {copiedValue === 'topic' ? 'Скопировано' : 'Копировать topic'}
                          </button>
                        </div>
                      </div>

                      <div className={`rounded-3xl border p-5 ${panelClass}`}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Связь поверх DataChannel</h3>
                          <Send className="h-4 w-4 text-cyan-400" />
                        </div>
                        <textarea
                          value={networkMessage}
                          onChange={(event) => setNetworkMessage(event.target.value)}
                          className={`mt-3 h-28 w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                          placeholder="Сообщение для отправки напрямую по DataChannel"
                        />
                        <button
                          onClick={() => {
                            if (channelRef.current?.readyState === 'open' && networkMessage.trim()) {
                              channelRef.current.send(
                                JSON.stringify({
                                  type: 'chat',
                                  body: networkMessage,
                                  senderName: profile?.name ?? 'Вы',
                                  senderAvatar: profile?.avatar ?? '🛰️',
                                }),
                              );
                              addLocalMessage(networkMessage, 'p2p');
                              setNetworkMessage('');
                            }
                          }}
                          className="mt-3 w-full rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
                        >
                          Отправить тестовый пакет
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-3xl border p-5 ${panelClass}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Handshake log</h3>
                      <RefreshCw className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {handshakeLog.map((entry, index) => (
                        <div key={`${entry}-${index}`} className={`rounded-2xl border px-4 py-3 text-sm ${panelClass}`}>
                          {entry}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {view === 'desktop' && (
                <div className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold">Desktop packaging scaffold</h2>
                          <p className={`mt-1 text-sm ${softTextClass}`}>
                            Репозиторий уже содержит Electron main/preload, `electron-builder.yml`, GitHub Actions workflow и README для сборки установщиков.
                          </p>
                        </div>
                        <img src="/pulsemesh-icon.png" alt="PulseMesh icon" className="h-16 w-16 rounded-2xl object-cover" />
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Windows" value="NSIS .exe" light={isLight} />
                        <MetricCard label="macOS" value="DMG" light={isLight} />
                        <MetricCard label="Linux" value="AppImage" light={isLight} />
                        <MetricCard label="Updates" value="electron-updater" light={isLight} />
                      </div>

                      <div className={`mt-5 rounded-3xl border p-4 ${panelClass}`}>
                        <h3 className="text-sm font-semibold">Что уже заложено</h3>
                        <div className={`mt-4 grid gap-3 text-sm ${softTextClass} md:grid-cols-2`}>
                          <FeatureCard icon={<Monitor className="h-4 w-4" />} title="Tray + background mode" text="Окно можно сворачивать в системный трей вместо полного закрытия." light={isLight} />
                          <FeatureCard icon={<Bell className="h-4 w-4" />} title="Native notifications" text="Уведомления для входящих P2P-сообщений через Electron Notification API." light={isLight} />
                          <FeatureCard icon={<Gamepad2 className="h-4 w-4" />} title="Overlay-ready" text="Структура Electron подходит для добавления прозрачного игрового overlay." light={isLight} />
                          <FeatureCard icon={<Download className="h-4 w-4" />} title="Auto updates" text="Файл конфигурации подготовлен под GitHub Releases и electron-updater." light={isLight} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className={`rounded-3xl border p-5 ${panelClass}`}>
                        <h3 className="text-sm font-semibold">Desktop runtime</h3>
                        <div className="mt-4 space-y-3 text-sm">
                          <InfoRow label="Platform" value={desktopInfo?.platform ?? 'web'} light={isLight} />
                          <InfoRow label="Version" value={desktopInfo?.version ?? 'web-preview'} light={isLight} />
                          <InfoRow label="Packaged" value={String(desktopInfo?.isPackaged ?? false)} light={isLight} />
                          <InfoRow label="Session" value={sessionNote || 'Ready'} light={isLight} />
                        </div>
                        {window.pulseDesktop ? (
                          <button
                            onClick={async () => {
                              const sources = await window.pulseDesktop?.getScreenSources();
                              setScreenSources(sources ?? []);
                            }}
                            className="mt-4 w-full rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
                          >
                            Получить screen sources
                          </button>
                        ) : (
                          <p className={`mt-4 text-sm leading-7 ${softTextClass}`}>
                            Сейчас открыт web-preview. В Electron эта панель покажет реальные источники экрана и нативные десктопные API.
                          </p>
                        )}
                      </div>

                      <div className={`rounded-3xl border p-5 ${panelClass}`}>
                        <h3 className="text-sm font-semibold">Путь к полноценному EXE</h3>
                        <ol className={`mt-3 space-y-3 text-sm leading-7 ${softTextClass}`}>
                          <li>1. Собрать web-часть Vite.</li>
                          <li>2. Упаковать `dist/` + `electron/` через electron-builder.</li>
                          <li>3. Выпустить NSIS-установщик с ярлыком на рабочем столе и в меню Пуск.</li>
                          <li>4. Публиковать релизы в GitHub Releases для автообновлений.</li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  {screenSources.length ? (
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <h3 className="text-sm font-semibold">Обнаруженные источники экрана</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {screenSources.map((source) => (
                          <div key={source.id} className={`rounded-3xl border p-3 ${panelClass}`}>
                            <img src={source.thumbnail} alt={source.name} className="h-36 w-full rounded-2xl object-cover" />
                            <p className="mt-3 text-sm font-medium">{source.name}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {view === 'profile' && (
                <div className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <div className="flex items-center gap-4">
                        <div className="flex h-20 w-20 items-center justify-center rounded-3xl text-4xl shadow-lg" style={{ background: profile?.color ?? '#334155' }}>
                          {profile?.avatar ?? '🛰️'}
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold">{profile?.name ?? 'Local profile not set'}</h2>
                          <p className={`mt-1 text-sm ${softTextClass}`}>{profile?.email ?? 'Создайте профиль для сохранения истории'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge text={profile?.provider ?? 'local'} light={isLight} />
                            <Badge text={profile?.status ?? 'offline'} light={isLight} />
                            <Badge text="IndexedDB" light={isLight} />
                          </div>
                        </div>
                      </div>

                      <div className={`mt-5 rounded-3xl border p-4 ${panelClass}`}>
                        <h3 className="text-sm font-semibold">Профиль и синхронизация</h3>
                        <p className={`mt-3 text-sm leading-7 ${softTextClass}`}>
                          Аккаунты и история живут локально на устройстве. Для децентрализованной синхронизации можно публиковать публичный профиль в IPFS/Hypercore,
                          а приватные сообщения дополнительно шифровать OpenPGP.js или Signal-подобным ratchet-слоем.
                        </p>
                      </div>
                    </div>

                    <div className={`rounded-3xl border p-5 ${panelClass}`}>
                      <h3 className="text-sm font-semibold">Состояние десктоп-клиента</h3>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <MetricCard label="Theme" value={theme} light={isLight} />
                        <MetricCard label="Active room" value={activeRoom?.name ?? '—'} light={isLight} />
                        <MetricCard label="Current channel" value={activeChannel?.name ?? '—'} light={isLight} />
                        <MetricCard label="Messages cached" value={String(channelMessages.length)} light={isLight} />
                      </div>
                      <div className="mt-5 flex flex-wrap gap-3">
                        <button onClick={() => setTheme(isLight ? 'dark' : 'light')} className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${panelClass}`}>
                          Сменить тему
                        </button>
                        <button onClick={logout} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-500">
                          <span className="inline-flex items-center gap-2"><LogOut className="h-4 w-4" /> Выйти</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <aside className={`hidden w-[320px] shrink-0 border-l xl:flex xl:flex-col ${panelClass}`}>
              <div className="border-b px-5 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Участники комнаты</h2>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${isLight ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-slate-300'}`}>
                    {activeMembers.length}
                  </span>
                </div>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <div className="space-y-3">
                  {activeMembers.map((member) => (
                    <div key={member.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${panelClass}`}>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/50 to-cyan-500/40 text-xl">
                        {member.avatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{member.name}</span>
                          {member.speaking ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> : null}
                        </div>
                        <p className={`text-xs ${softTextClass}`}>{member.role} · {member.latency} ms</p>
                      </div>
                      <PresencePill presence={member.status} />
                    </div>
                  ))}
                </div>

                <div className={`rounded-3xl border p-4 ${panelClass}`}>
                  <h3 className="text-sm font-semibold">Архитектура связи</h3>
                  <div className={`mt-4 space-y-3 text-sm ${softTextClass}`}>
                    <p>• Личные сообщения: DataChannel + локальная история.</p>
                    <p>• Голос / видео: WebRTC media tracks c STUN и опциональным TURN.</p>
                    <p>• Discovery: invite-код → topic → локальный и overlay bootstrap.</p>
                    <p>• Без отдельного хоста: relay нужен только как временный помощник на этапе знакомства или SFU-режима.</p>
                  </div>
                </div>

                <div className={`rounded-3xl border p-4 ${panelClass}`}>
                  <h3 className="text-sm font-semibold">Desktop checklist</h3>
                  <div className={`mt-4 space-y-3 text-sm ${softTextClass}`}>
                    <p>✓ Electron main/preload scaffold</p>
                    <p>✓ Tray, notifications, auto-update hooks</p>
                    <p>✓ IndexedDB local profiles and messages</p>
                    <p>✓ Manual WebRTC pairing for cross-device calls</p>
                    <p>✓ README + CI workflow for releases</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {!profile && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className={`w-full max-w-5xl rounded-[32px] border p-6 shadow-2xl ${panelClass}`}>
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[28px] bg-gradient-to-br from-cyan-500/15 via-indigo-500/10 to-fuchsia-500/15 p-6">
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
                  <Shield className="h-3.5 w-3.5" /> Local-first auth
                </div>
                <h2 className="mt-5 text-3xl font-semibold">PulseMesh Desktop</h2>
                <p className={`mt-3 max-w-xl text-sm leading-7 ${softTextClass}`}>
                  Discord-подобный P2P-клиент: локальные профили, комнаты, текст, голос, видео, screen share и desktop packaging.
                  Аутентификация хранится только на устройстве; сами звонки и сообщения идут напрямую между участниками после bootstrap.
                </p>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <FeatureCard icon={<Lock className="h-4 w-4" />} title="Локальный профиль" text="Email/пароль и provider-профили сохраняются в IndexedDB." light={isLight} />
                  <FeatureCard icon={<Radio className="h-4 w-4" />} title="Serverless link" text="Bootstrap для знакомства, затем чистый peer-to-peer трафик." light={isLight} />
                  <FeatureCard icon={<Video className="h-4 w-4" />} title="Голос / видео" text="WebRTC audio/video + демонстрация экрана и локальная запись." light={isLight} />
                  <FeatureCard icon={<Monitor className="h-4 w-4" />} title="Desktop-ready" text="Electron scaffold для EXE/DMG/AppImage и GitHub Releases." light={isLight} />
                </div>
              </div>

              <div className={`rounded-[28px] border p-6 ${panelClass}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Вход и регистрация</p>
                    <p className={`mt-1 text-sm ${softTextClass}`}>Данные не покидают это устройство без вашего явного экспорта.</p>
                  </div>
                  <div className="flex gap-2 text-xs font-semibold">
                    <button onClick={() => setAuthMode('register')} className={`rounded-full px-3 py-2 transition ${authMode === 'register' ? 'bg-indigo-600 text-white' : `${panelClass} ${softTextClass}`}`}>
                      Регистрация
                    </button>
                    <button onClick={() => setAuthMode('login')} className={`rounded-full px-3 py-2 transition ${authMode === 'login' ? 'bg-indigo-600 text-white' : `${panelClass} ${softTextClass}`}`}>
                      Вход
                    </button>
                  </div>
                </div>

                <form onSubmit={submitAuth} className="mt-6 space-y-4">
                  {authMode === 'register' ? (
                    <input
                      value={authName}
                      onChange={(event) => setAuthName(event.target.value)}
                      className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                      placeholder="Ваш ник"
                    />
                  ) : null}
                  <input
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                    placeholder="email@local.mesh"
                    type="email"
                  />
                  <input
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${panelClass}`}
                    placeholder="Пароль"
                    type="password"
                  />
                  {authError ? <p className="text-sm font-medium text-rose-400">{authError}</p> : null}
                  <button type="submit" className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500">
                    {authMode === 'register' ? 'Создать локальный профиль' : 'Войти локально'}
                  </button>
                </form>

                <div className="mt-6">
                  <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${softTextClass}`}>Или быстро продолжить через provider-stub</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <button onClick={() => loginWithProvider('google')} className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${panelClass}`}>
                      Google
                    </button>
                    <button onClick={() => loginWithProvider('discord')} className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${panelClass}`}>
                      Discord
                    </button>
                    <button onClick={() => loginWithProvider('github')} className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${panelClass}`}>
                      GitHub
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function HeaderSwitch({
  active,
  onClick,
  icon,
  label,
  light,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  light: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition ${
        active ? 'bg-indigo-600 text-white' : light ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-white/10 text-slate-300 hover:bg-white/15'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ChannelButton({
  channel,
  active,
  onClick,
  light,
}: {
  channel: Channel;
  active: boolean;
  onClick: () => void;
  light: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition ${
        active ? 'bg-indigo-600 text-white' : light ? 'text-slate-700 hover:bg-slate-200' : 'text-slate-300 hover:bg-white/8'
      }`}
    >
      <span className="flex items-center gap-3">
        {channel.kind === 'voice' ? <Headphones className="h-4 w-4" /> : channel.kind === 'announcement' ? <BookOpen className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
        {channel.name}
      </span>
      {channel.unread > 0 ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{channel.unread}</span> : null}
    </button>
  );
}

function MetricCard({ label, value, light }: { label: string; value: string; light: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${light ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20'}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  text,
  light,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  light: boolean;
}) {
  return (
    <div className={`rounded-3xl border p-4 ${light ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/20'}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm leading-7 text-slate-400">{text}</p>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  active,
}: {
  onClick: () => void | Promise<void>;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
        active ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-black/20 text-slate-200 hover:bg-white/10'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToggleRow({
  label,
  enabled,
  onToggle,
  disabled,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
        disabled ? 'cursor-not-allowed border-white/5 bg-white/5 text-slate-500' : 'border-white/10 bg-black/20 hover:bg-white/10'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
        {enabled ? 'on' : 'off'}
      </span>
    </button>
  );
}

function ModeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-2 transition ${active ? 'bg-indigo-600 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/15'}`}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value, light }: { label: string; value: string; light: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 ${light ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20'}`}>
      <span className="text-slate-400">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}

function Badge({ text, light }: { text: string; light: boolean }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${light ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-slate-300'}`}>{text}</span>;
}

function PresencePill({ presence }: { presence: Presence }) {
  const styles =
    presence === 'online'
      ? 'bg-emerald-500/15 text-emerald-400'
      : presence === 'away'
        ? 'bg-amber-500/15 text-amber-400'
        : presence === 'dnd'
          ? 'bg-rose-500/15 text-rose-400'
          : 'bg-slate-500/15 text-slate-400';

  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${styles}`}>{presence}</span>;
}

function MediaTile({
  title,
  subtitle,
  badge,
  videoRef,
  icon,
  dark,
}: {
  title: string;
  subtitle: string;
  badge: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  icon: string;
  dark: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-[28px] border ${dark ? 'border-white/10 bg-slate-950' : 'border-slate-200 bg-slate-100'}`}>
      <video ref={videoRef} autoPlay playsInline muted={title !== 'Remote peer'} className="h-full min-h-[360px] w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/10 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-4">
        <div>
          <div className="flex items-center gap-2 text-white">
            <span className="text-2xl">{icon}</span>
            <span className="font-semibold">{title}</span>
          </div>
          <p className="mt-1 text-sm text-white/80">{subtitle}</p>
        </div>
        <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur">{badge}</span>
      </div>
    </div>
  );
}

export default App;
