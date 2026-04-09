import { create } from 'zustand';

export type Presence = 'online' | 'away' | 'dnd' | 'offline';
export type ChannelKind = 'text' | 'voice' | 'announcement';
export type RoomMode = 'mesh' | 'sfu' | 'lan';
export type WorkspaceView = 'chat' | 'call' | 'network' | 'desktop' | 'profile';

export interface LocalUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  color: string;
  provider: 'email' | 'google' | 'discord' | 'github';
  passwordHash: string;
  status: Presence;
  tagline: string;
}

export interface Member {
  id: string;
  name: string;
  avatar: string;
  role: string;
  status: Presence;
  speaking: boolean;
  muted: boolean;
  latency: number;
}

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  topic: string;
  unread: number;
}

export interface Room {
  id: string;
  name: string;
  code: string;
  mode: RoomMode;
  channels: Channel[];
  members: Member[];
  description: string;
}

export interface AttachmentMeta {
  name: string;
  sizeLabel: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  body: string;
  timestamp: string;
  via: 'system' | 'local' | 'p2p';
  encrypted: boolean;
  reactions?: string[];
  attachments?: AttachmentMeta[];
}

const defaultRooms: Room[] = [
  {
    id: 'room-pulsemesh',
    name: 'PulseMesh HQ',
    code: 'room-pulsemesh',
    mode: 'mesh',
    description: 'Основная P2P-комната с каналами, звонками и ручным WebRTC-handshake.',
    channels: [
      { id: 'chan-lobby', name: 'лобби', kind: 'text', topic: 'Общий E2EE-чат и запуск подключений.', unread: 3 },
      { id: 'chan-builds', name: 'релизы', kind: 'announcement', topic: 'Сборки Electron, обновления, дистрибутивы.', unread: 1 },
      { id: 'chan-voice', name: 'voice lounge', kind: 'voice', topic: 'Голос / видео / screen share по WebRTC.', unread: 0 },
    ],
    members: [
      { id: 'member-you', name: 'Вы', avatar: '🛰️', role: 'Owner', status: 'online', speaking: true, muted: false, latency: 12 },
      { id: 'member-luna', name: 'Luna', avatar: '🌙', role: 'Moderator', status: 'online', speaking: false, muted: false, latency: 26 },
      { id: 'member-kite', name: 'Kite', avatar: '🪁', role: 'Builder', status: 'away', speaking: false, muted: true, latency: 42 },
      { id: 'member-rn', name: 'RNNoise Bot', avatar: '🎛️', role: 'DSP', status: 'dnd', speaking: false, muted: true, latency: 7 },
    ],
  },
  {
    id: 'room-lan-lab',
    name: 'LAN Lab',
    code: 'room-lan-lab',
    mode: 'lan',
    description: 'Поиск пиров в локальной сети через Hyperswarm/WebTorrent discovery.',
    channels: [
      { id: 'chan-lan-text', name: 'lan-text', kind: 'text', topic: 'Оффлайн-режим и локальные пировые чаты.', unread: 0 },
      { id: 'chan-lan-voice', name: 'lan-voice', kind: 'voice', topic: 'Голосовые звонки по локалке.', unread: 0 },
    ],
    members: [
      { id: 'member-lan-you', name: 'Вы', avatar: '🛰️', role: 'Peer', status: 'online', speaking: false, muted: false, latency: 3 },
      { id: 'member-lan-rin', name: 'Rin', avatar: '🧪', role: 'Peer', status: 'online', speaking: false, muted: false, latency: 8 },
    ],
  },
];

const defaultMessages: Record<string, ChatMessage[]> = {
  'room-pulsemesh:chan-lobby': [
    {
      id: 'msg-1',
      channelId: 'chan-lobby',
      senderId: 'system',
      senderName: 'PulseMesh System',
      senderAvatar: '🛡️',
      body: 'Добро пожаловать в PulseMesh. Медиа и сообщения идут peer-to-peer; сигнальный слой нужен только для обмена offer/answer и ICE-кандидатами.',
      timestamp: '09:12',
      via: 'system',
      encrypted: true,
      reactions: ['🔐', '📡'],
    },
    {
      id: 'msg-2',
      channelId: 'chan-lobby',
      senderId: 'member-luna',
      senderName: 'Luna',
      senderAvatar: '🌙',
      body: 'Для групп до 6-8 участников используем mesh: каждый пир держит прямые соединения со всеми. Для больших комнат предлагаем временный SFU relay-узел, выбранный автоматически среди участников.',
      timestamp: '09:14',
      via: 'p2p',
      encrypted: true,
      reactions: ['🫶'],
    },
  ],
  'room-pulsemesh:chan-builds': [
    {
      id: 'msg-3',
      channelId: 'chan-builds',
      senderId: 'system',
      senderName: 'Release Bot',
      senderAvatar: '📦',
      body: 'Desktop scaffold ready: Electron main/preload, electron-builder config, auto-update wiring, tray mode, notifications, and GitHub Actions workflow are included in this repository.',
      timestamp: '10:01',
      via: 'system',
      encrypted: false,
      attachments: [{ name: 'release-notes.md', sizeLabel: '12 KB' }],
    },
  ],
  'room-lan-lab:chan-lan-text': [
    {
      id: 'msg-4',
      channelId: 'chan-lan-text',
      senderId: 'member-lan-rin',
      senderName: 'Rin',
      senderAvatar: '🧪',
      body: 'LAN discovery mode works without internet: all peers derive a deterministic topic from the room code and probe local/overlay discovery transports to find each other.',
      timestamp: '11:08',
      via: 'p2p',
      encrypted: true,
    },
  ],
};

const randomCode = () => `room-${Math.random().toString(36).slice(2, 8)}`;

interface HydratedState {
  profile: LocalUser | null;
  rooms: Room[];
  messages: Record<string, ChatMessage[]>;
  theme: 'dark' | 'light';
}

interface AppStore {
  theme: 'dark' | 'light';
  view: WorkspaceView;
  profile: LocalUser | null;
  rooms: Room[];
  activeRoomId: string;
  activeChannelId: string;
  messages: Record<string, ChatMessage[]>;
  setTheme: (theme: 'dark' | 'light') => void;
  setView: (view: WorkspaceView) => void;
  setProfile: (profile: LocalUser | null) => void;
  hydrate: (state: Partial<HydratedState>) => void;
  setActiveRoom: (roomId: string) => void;
  setActiveChannel: (channelId: string) => void;
  createRoom: (name: string, mode: RoomMode) => Room;
  joinRoom: (code: string) => Room;
  addMessage: (roomId: string, channelId: string, message: ChatMessage) => void;
  upsertMember: (roomId: string, member: Member) => void;
  updateMemberState: (roomId: string, memberId: string, patch: Partial<Member>) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
  volumes: Record<string, { speaker: number; mic: number }>;
  setVolume: (userId: string, type: 'speaker' | 'mic', value: number) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  theme: 'dark',
  view: 'chat',
  profile: null,
  rooms: defaultRooms,
  activeRoomId: defaultRooms[0].id,
  activeChannelId: defaultRooms[0].channels[0].id,
  messages: defaultMessages,
  avatarUrl: null,
  volumes: {},
  setTheme: (theme) => set({ theme }),
  setView: (view) => set({ view }),
  setProfile: (profile) => set({ profile }),
  setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
  setVolume: (userId, type, value) =>
    set((state) => ({
      volumes: {
        ...state.volumes,
        [userId]: { ...(state.volumes[userId] || { speaker: 0.5, mic: 0.5 }), [type]: value },
      },
    })),
  hydrate: (state) =>
    set((current) => ({
      profile: state.profile ?? current.profile,
      rooms: state.rooms?.length ? state.rooms : current.rooms,
      messages: Object.keys(state.messages ?? {}).length ? state.messages ?? current.messages : current.messages,
      theme: state.theme ?? current.theme,
    })),
  setActiveRoom: (roomId) => {
    const room = get().rooms.find((item) => item.id === roomId);
    set({
      activeRoomId: roomId,
      activeChannelId: room?.channels[0]?.id ?? get().activeChannelId,
    });
  },
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
  createRoom: (name, mode) => {
    const room: Room = {
      id: crypto.randomUUID(),
      name,
      code: randomCode(),
      mode,
      description:
        mode === 'lan'
          ? 'Локальная автономная комната для оффлайн-режима.'
          : mode === 'sfu'
            ? 'Гибридная комната с временным peer-relay для больших групп.'
            : 'Mesh-комната с прямыми соединениями между всеми участниками.',
      channels: [
        { id: crypto.randomUUID(), name: 'general', kind: 'text', topic: 'Основной канал комнаты.', unread: 0 },
        { id: crypto.randomUUID(), name: 'meeting', kind: 'voice', topic: 'Быстрый голосовой созвон.', unread: 0 },
      ],
      members: [
        {
          id: get().profile?.id ?? 'member-you',
          name: get().profile?.name ?? 'Вы',
          avatar: get().profile?.avatar ?? '🛰️',
          role: 'Owner',
          status: 'online',
          speaking: false,
          muted: false,
          latency: 0,
        },
      ],
    };

    set((state) => ({
      rooms: [...state.rooms, room],
      activeRoomId: room.id,
      activeChannelId: room.channels[0].id,
      view: 'chat',
    }));

    return room;
  },
  joinRoom: (code) => {
    const existing = get().rooms.find((room) => room.code === code.trim());
    if (existing) {
      set({ activeRoomId: existing.id, activeChannelId: existing.channels[0].id, view: 'chat' });
      return existing;
    }

    const room: Room = {
      id: crypto.randomUUID(),
      name: `Joined ${code.slice(-4).toUpperCase()}`,
      code,
      mode: 'mesh',
      description: 'Комната получена по invite-коду. Сначала сигналинг, затем прямые P2P-потоки.',
      channels: [
        { id: crypto.randomUUID(), name: 'welcome', kind: 'text', topic: 'Сообщения после подключения.', unread: 0 },
        { id: crypto.randomUUID(), name: 'call', kind: 'voice', topic: 'Голосовой канал комнаты.', unread: 0 },
      ],
      members: [
        {
          id: get().profile?.id ?? 'member-you',
          name: get().profile?.name ?? 'Вы',
          avatar: get().profile?.avatar ?? '🛰️',
          role: 'Peer',
          status: 'online',
          speaking: false,
          muted: false,
          latency: 14,
        },
        { id: crypto.randomUUID(), name: 'Remote Peer', avatar: '⚡', role: 'Peer', status: 'online', speaking: false, muted: false, latency: 21 },
      ],
    };

    set((state) => ({
      rooms: [...state.rooms, room],
      activeRoomId: room.id,
      activeChannelId: room.channels[0].id,
      view: 'chat',
    }));

    return room;
  },
  addMessage: (roomId, channelId, message) =>
    set((state) => {
      const key = `${roomId}:${channelId}`;
      return {
        messages: {
          ...state.messages,
          [key]: [...(state.messages[key] ?? []), message],
        },
      };
    }),
  upsertMember: (roomId, member) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id !== roomId
          ? room
          : {
              ...room,
              members: room.members.some((item) => item.id === member.id)
                ? room.members.map((item) => (item.id === member.id ? member : item))
                : [...room.members, member],
            },
      ),
    })),
  updateMemberState: (roomId, memberId, patch) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.id !== roomId
          ? room
          : {
              ...room,
              members: room.members.map((member) =>
                member.id === memberId ? { ...member, ...patch } : member,
              ),
            },
      ),
    })),
}));
