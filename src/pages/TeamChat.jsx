import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth, useToast } from '../App'
import { useGetEmployeesQuery } from '../store/apiSlice'
import api from '../services/api'
import {
  CheckCheck, MessageCircle,
  Search, Send, Smile, UserRound, Users, RefreshCw
} from 'lucide-react'

function initialsFromName(name) {
  return (name || 'User')
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function conversationIdFor(employeeId) {
  return employeeId ? `hr-employee-${employeeId}` : ''
}

function employeeConversationId(currentId, otherId) {
  if (!currentId || !otherId) return ''
  return [String(currentId), String(otherId)].sort().join('-')
}

function stopStream(stream) {
  stream?.getTracks().forEach(track => track.stop())
}

function statusText(call, currentUserId) {
  if (!call?.status || call.status === 'idle') return 'Ready to connect'
  const person = call.user_id === currentUserId ? 'You' : call.user || 'Someone'
  const labels = {
    joined: 'joined the call',
    left: 'left the call',
    screen_started: 'started screen sharing',
    screen_stopped: 'stopped screen sharing',
    muted: 'muted microphone',
    unmuted: 'unmuted microphone',
    camera_off: 'turned camera off',
    camera_on: 'turned camera on',
  }
  return `${person} ${labels[call.status] || call.status}`
}

function RemoteVideoTile({ peer }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream
    }
  }, [peer.stream])

  return (
    <div className="team-video-tile remote">
      <video ref={videoRef} autoPlay playsInline />
      <div className="team-video-label">{peer.name || 'Participant'}</div>
    </div>
  )
}

export default function TeamChat() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const isHr = user?.role === 'hr'
  const currentUserId = String(user?.id || '')
  const conversationParam = searchParams.get('conversation') || ''
  const teamRoomParam = searchParams.get('team_room') || ''
  const roomParam = searchParams.get('room') || ''
  
  // ----- RTK Query Hooks -----
  const { data: employeesRes, isFetching: loadingPeople } = useGetEmployeesQuery({
    status: 'active',
    per_page: 200
  })
  const employees = employeesRes?.data?.employees || employeesRes?.data || []

  const [activeConversation, setActiveConversation] = useState(() => conversationParam)
  const [activeRoomId, setActiveRoomId] = useState(() => teamRoomParam)
  const [mobileViewActive, setMobileViewActive] = useState(false)
  const [teamRooms, setTeamRooms] = useState([])
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [starredMessages, setStarredMessages] = useState(() => new Set())
  const [pinnedMessageId, setPinnedMessageId] = useState('')
  const [query, setQuery] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [callStatus, setCallStatus] = useState(null)
  const [callRooms, setCallRooms] = useState([])
  const [activeCallRoom, setActiveCallRoom] = useState(searchParams.get('room') || '')
  const [callMode, setCallMode] = useState('private')
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([])
  const [inviting, setInviting] = useState(false)
  const [callActive, setCallActive] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [screenOn, setScreenOn] = useState(false)
  const [remotePeers, setRemotePeers] = useState([])
  const localVideoRef = useRef(null)
  const screenVideoRef = useRef(null)

  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const messagesEndRef = useRef(null)
  const toastRef = useRef(toast)
  const chatLoadedRef = useRef(false)
  const chatSeenMessageIdsRef = useRef(new Set())
  const peerConnectionsRef = useRef({})
  const remoteStreamsRef = useRef({})
  const processedSignalsRef = useRef(new Set())
  const pendingIceRef = useRef({})
  const lastOfferAtRef = useRef({})
  const timeStartRef = useRef(0)
  const callSyncTimeoutRef = useRef(null)
  // In-memory message cache: Map<conversationId|roomId, { messages, hasMore }>
  const messageCacheRef = useRef(new Map())
  // AbortController for in-flight message requests
  const msgAbortRef = useRef(null)
  // Debounce timer for conversation switch
  const switchDebounceRef = useRef(null)

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const conversations = useMemo(() => {
    if (!isHr) {
      const employeeChats = employees
        .filter(emp => String(emp.id) !== currentUserId)
        .map(emp => ({
          id: `employee-employee-${employeeConversationId(currentUserId, emp.id)}`,
          personId: emp.id,
          name: emp.name || 'Employee',
          desc: [emp.department, emp.designation, emp.employee_code].filter(Boolean).join(' - ') || 'Employee',
          role: emp.status || 'Employee',
          type: 'employee',
        }))

      return [{
        id: conversationIdFor(currentUserId),
        personId: 'hr',
        name: 'HR Admin',
        desc: 'Private HR support chat',
        role: 'Human Resource',
        type: 'hr',
      }, ...employeeChats]
    }

    return employees.map(emp => ({
      id: conversationIdFor(emp.id),
      personId: emp.id,
      name: emp.name || 'Employee',
      desc: [emp.department, emp.designation, emp.employee_code].filter(Boolean).join(' - ') || 'Employee',
      role: emp.status || 'Employee',
      type: 'employee',
    }))
  }, [currentUserId, employees, isHr])
  const visibleConversations = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter(item => `${item.name} ${item.desc}`.toLowerCase().includes(term))
  }, [conversations, query])
  const visibleTeamRooms = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return teamRooms
    return teamRooms.filter(room => `${room.name || ''} ${room.department || ''}`.toLowerCase().includes(term))
  }, [query, teamRooms])

  const selectedConversation = conversations.find(item => item.id === activeConversation) || conversations[0]
  const selectedTeamRoom = teamRooms.find(room => room.id === activeRoomId)
  const selectedRoom = callRooms.find(room => room.room_id === activeCallRoom)
  const currentCallTitle = selectedRoom?.title || selectedConversation?.name || 'Call Room'
  const isCallHost = isHr || selectedRoom?.host_id === currentUserId
  const pinnedMessage = messages.find(item => item.id === pinnedMessageId)
  const activeEmployeesCount = employees.length

  const inviteParticipantIds = useMemo(() => {
    if (!selectedConversation || selectedConversation.personId === 'hr') return []
    if (callMode === 'private') return selectedConversation?.personId && selectedConversation.personId !== 'hr'
      ? [selectedConversation.personId]
      : []
    return selectedParticipantIds
  }, [callMode, selectedConversation, selectedParticipantIds])

  const loadTeamRooms = useCallback(() => {
    api.get('/team-chat.php', { params: { action: 'team_rooms' } })
      .then(res => {
        setTeamRooms(res.data?.data?.rooms || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadTeamRooms()
  }, [loadTeamRooms])

  useEffect(() => {
    if (employees.length > 0 && !teamRoomParam) {
      const first = isHr
        ? conversationIdFor(employees[0].id)
        : conversationIdFor(currentUserId)
      setActiveConversation(prev => prev || first)
      setSelectedParticipantIds(prev => prev.length ? prev : [String(employees[0].id)])
    }
  }, [employees, isHr, currentUserId, teamRoomParam])

  useEffect(() => {
    if (!conversationParam || conversations.length === 0) return
    if (conversations.some(item => item.id === conversationParam)) {
      setActiveConversation(conversationParam)
      setActiveRoomId('')
    }
  }, [conversationParam, conversations])

  useEffect(() => {
    if (teamRoomParam) {
      setActiveRoomId(teamRoomParam)
      setActiveConversation('')
    }
  }, [teamRoomParam])

  useEffect(() => {
    if (conversations.length === 0) return
    if (activeRoomId) return
    if (activeConversation && conversations.some(item => item.id === activeConversation)) return
    const requestedConversation = conversations.find(item => item.id === conversationParam)
    setActiveConversation(requestedConversation?.id || conversations[0].id)
  }, [activeConversation, activeRoomId, conversationParam, conversations])

  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)

  const loadMessages = useCallback((showLoading = false, beforeId = undefined) => {
    const cacheKey = activeRoomId || activeConversation
    if (!cacheKey) return

    // Cancel any in-flight request before starting a new one
    if (msgAbortRef.current) {
      msgAbortRef.current.abort()
      msgAbortRef.current = null
    }

    // Show cached messages immediately on first switch (before fresh data arrives)
    if (showLoading && !beforeId && messageCacheRef.current.has(cacheKey)) {
      const cached = messageCacheRef.current.get(cacheKey)
      setMessages(cached.messages)
      setHasMoreMessages(cached.hasMore)
      setLoadingMessages(false)
    } else if (showLoading && !beforeId) {
      setLoadingMessages(true)
    }

    const controller = new AbortController()
    msgAbortRef.current = controller

    if (activeRoomId) {
      const params = { action: 'team_messages', room_id: activeRoomId, limit: 30 }
      if (beforeId) params.before = beforeId

      api.get('/team-chat.php', { params, signal: controller.signal })
        .then(res => {
          const nextMessages = res.data?.data?.messages || []
          const hasMore = res.data?.data?.has_more === true

          if (beforeId) {
            // Prepend older messages
            setMessages(prev => [...nextMessages, ...prev])
          } else {
            const incoming = !showLoading && chatLoadedRef.current
              ? nextMessages.filter(message =>
                  !chatSeenMessageIdsRef.current.has(message.id) &&
                  String(message.sender_id) !== currentUserId
                )
              : []

            chatSeenMessageIdsRef.current = new Set(nextMessages.map(message => message.id))
            chatLoadedRef.current = true

            const mapped = nextMessages.map(msg => ({
              id: msg.id,
              author_id: msg.sender_id,
              author: msg.sender_name,
              role: String(msg.sender_id) === 'hr' ? 'hr' : 'employee',
              text: msg.message,
              created_at: msg.created_at,
              profile_image: msg.sender_profile_image
            }))
            setMessages(mapped)

            // Cache fresh result
            messageCacheRef.current.set(cacheKey, { messages: mapped, hasMore })

            if (incoming.length > 0) {
              const latest = incoming[incoming.length - 1]
              const previewText = latest.text ? latest.text.slice(0, 60) : 'sent an attachment'
              toastRef.current(`New message in room: ${previewText}`, 'info')
            }
          }

          setHasMoreMessages(hasMore)
        })
        .catch(err => { if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {} })
        .finally(() => {
          if (showLoading) setLoadingMessages(false)
          if (beforeId) setLoadingOlderMessages(false)
        })
      return
    }

    if (!activeConversation) return
    const params = { action: 'messages', conversation_id: activeConversation, limit: 30 }
    if (beforeId) params.before = beforeId

    api.get('/team-chat.php', { params, signal: controller.signal })
      .then(res => {
        const nextMessages = res.data?.data?.messages || []
        const hasMore = res.data?.data?.has_more === true

        if (beforeId) {
          setMessages(prev => [...nextMessages, ...prev])
        } else {
          const incoming = !showLoading && chatLoadedRef.current
            ? nextMessages.filter(message =>
                !chatSeenMessageIdsRef.current.has(message.id) &&
                String(message.author_id) !== currentUserId
              )
            : []

          chatSeenMessageIdsRef.current = new Set(nextMessages.map(message => message.id))
          chatLoadedRef.current = true
          setMessages(nextMessages)

          // Cache fresh result
          messageCacheRef.current.set(cacheKey, { messages: nextMessages, hasMore })

          if (incoming.length > 0) {
            const latest = incoming[incoming.length - 1]
            const preview = latest.text ? `: ${latest.text.slice(0, 60)}` : ' sent an attachment'
            toastRef.current(`New message from ${latest.author}${preview}`, 'info')
          }
        }

        setHasMoreMessages(hasMore)
      })
      .catch(err => { if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {} })
      .finally(() => {
        if (showLoading) setLoadingMessages(false)
        if (beforeId) setLoadingOlderMessages(false)
      })
  }, [activeConversation, activeRoomId, currentUserId])

  const loadCallRooms = useCallback(() => {
    api.get('/team-chat.php', { params: { action: 'rooms' } })
      .then(res => setCallRooms(res.data?.data?.rooms || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!roomParam) return
    setActiveCallRoom(roomParam)
    loadCallRooms()
  }, [loadCallRooms, roomParam])

  useEffect(() => {
    // Clear previous debounce
    clearTimeout(switchDebounceRef.current)

    // Abort any in-flight request immediately
    if (msgAbortRef.current) {
      msgAbortRef.current.abort()
      msgAbortRef.current = null
    }

    // Reset chat state
    chatLoadedRef.current = false
    chatSeenMessageIdsRef.current = new Set()
    setCallStatus(null)
    setDraft('')
    setHasMoreMessages(false)
    if (!roomParam) setActiveCallRoom('')

    // Debounce the fetch by 300ms (prevents bursts on rapid switching)
    switchDebounceRef.current = setTimeout(() => {
      loadMessages(true)
      // Note: loadCallStatus is NOT called here — it's called only on click
    }, 300)

    return () => clearTimeout(switchDebounceRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation, activeRoomId, roomParam])

  // Polling intervals removed per user request: "no api call only when refresh"

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeConversation, activeRoomId, messages])

  useEffect(() => {
    if (callActive && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
    }
  }, [callActive])

  useEffect(() => () => {
    if (callSyncTimeoutRef.current) {
      window.clearTimeout(callSyncTimeoutRef.current)
    }
    stopStream(localStreamRef.current)
    stopStream(screenStreamRef.current)
    closePeerConnections()
  }, [])

  useEffect(() => {
    if (!callActive || !activeCallRoom) return undefined
    syncCallRoom(activeCallRoom)
    const syncTimer = setInterval(() => syncCallRoom(activeCallRoom), 1800)
    return () => clearInterval(syncTimer)
  }, [activeCallRoom, callActive, currentUserId])



  function removePeer(peerId) {
    peerConnectionsRef.current[peerId]?.close()
    delete peerConnectionsRef.current[peerId]
    delete remoteStreamsRef.current[peerId]
    delete pendingIceRef.current[peerId]
    delete lastOfferAtRef.current[peerId]
    setRemotePeers(prev => prev.filter(peer => peer.id !== peerId))
  }

  function closePeerConnections() {
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
    peerConnectionsRef.current = {}
    remoteStreamsRef.current = {}
    pendingIceRef.current = {}
    lastOfferAtRef.current = {}
    processedSignalsRef.current = new Set()
    setRemotePeers([])
  }

  async function sendSignal(toUserId, type, payload, roomId = activeCallRoom) {
    if (!roomId || !toUserId) return
    try {
      await api.post('/team-chat.php?action=signal', {
        room_id: roomId,
        to_user_id: toUserId,
        type,
        payload,
      })
    } catch {}
  }

  async function drainPendingIce(peerId) {
    const pc = peerConnectionsRef.current[peerId]
    if (!pc?.remoteDescription) return
    const queued = pendingIceRef.current[peerId] || []
    pendingIceRef.current[peerId] = []
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
    }
  }

  async function addIceCandidate(peerId, candidate) {
    const pc = peerConnectionsRef.current[peerId]
    if (!pc || !candidate) return
    if (!pc.remoteDescription) {
      pendingIceRef.current[peerId] = [...(pendingIceRef.current[peerId] || []), candidate]
      return
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
  }

  function updateRemoteStream(peer) {
    const stream = remoteStreamsRef.current[peer.user_id]
    if (!stream) return
    setRemotePeers(prev => {
      const nextPeer = { id: peer.user_id, name: peer.name, stream }
      return prev.some(item => item.id === peer.user_id)
        ? prev.map(item => item.id === peer.user_id ? nextPeer : item)
        : [...prev, nextPeer]
    })
  }

  async function sendOffer(peer, pc, roomId = activeCallRoom, force = false) {
    const now = Date.now()
    if (!force && now - (lastOfferAtRef.current[peer.user_id] || 0) < 3500) return
    if (!pc || pc.signalingState === 'closed') return
    if (pc.signalingState !== 'stable' && pc.localDescription?.type === 'offer') {
      lastOfferAtRef.current[peer.user_id] = now
      await sendSignal(peer.user_id, 'offer', pc.localDescription, roomId)
      return
    }
    if (pc.signalingState !== 'stable') return
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    await pc.setLocalDescription(offer)
    lastOfferAtRef.current[peer.user_id] = now
    await sendSignal(peer.user_id, 'offer', offer, roomId)
  }

  async function createPeerConnection(peer, initiator = false, roomId = activeCallRoom) {
    if (!localStreamRef.current || !roomId || !peer?.user_id || peer.user_id === currentUserId) return null
    if (peerConnectionsRef.current[peer.user_id]) {
      const existing = peerConnectionsRef.current[peer.user_id]
      if (initiator && !remoteStreamsRef.current[peer.user_id]?.getTracks().length) {
        await sendOffer(peer, existing, roomId)
      }
      return existing
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peerConnectionsRef.current[peer.user_id] = pc
    remoteStreamsRef.current[peer.user_id] = new MediaStream()

    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current)
    })

    pc.onicecandidate = event => {
      if (event.candidate) {
        sendSignal(peer.user_id, 'ice', event.candidate.toJSON(), roomId)
      }
    }

    pc.ontrack = event => {
      const remoteStream = remoteStreamsRef.current[peer.user_id] || new MediaStream()
      remoteStreamsRef.current[peer.user_id] = remoteStream
      event.streams[0]?.getTracks().forEach(track => {
        if (!remoteStream.getTracks().some(existing => existing.id === track.id)) {
          remoteStream.addTrack(track)
        }
      })
      updateRemoteStream(peer)
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        removePeer(peer.user_id)
      }
    }

    if (initiator) {
      await sendOffer(peer, pc, roomId, true)
    }

    return pc
  }

  async function handleSignal(signal) {
    if (!signal?.id || processedSignalsRef.current.has(signal.id)) return
    processedSignalsRef.current.add(signal.id)
    const peer = { user_id: signal.from_user_id, name: signal.from_name }
    const pc = await createPeerConnection(peer, false, signal.room_id)
    if (!pc) return

    if (signal.type === 'offer') {
      if (pc.signalingState !== 'stable') {
        try { await pc.setLocalDescription({ type: 'rollback' }) } catch {}
      }
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
      await drainPendingIce(signal.from_user_id)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendSignal(signal.from_user_id, 'answer', answer, signal.room_id)
    } else if (signal.type === 'answer') {
      if (pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload))
        await drainPendingIce(signal.from_user_id)
      }
    } else if (signal.type === 'ice') {
      await addIceCandidate(signal.from_user_id, signal.payload)
    }
  }

  async function syncCallRoom(roomId = activeCallRoom) {
    if (!callActive || !roomId) return
    try {
      await api.post('/team-chat.php?action=join', { room_id: roomId })
      const [peersRes, signalsRes] = await Promise.all([
        api.get('/team-chat.php', { params: { action: 'peers', room_id: roomId } }),
        api.get('/team-chat.php', { params: { action: 'signals', room_id: roomId } }),
      ])
      const peers = peersRes.data?.data?.peers || []
      for (const peer of peers) {
        if (peer.user_id !== currentUserId && isCallHost) {
          await createPeerConnection(peer, true, roomId)
        } else if (peer.user_id !== currentUserId && !peerConnectionsRef.current[peer.user_id]) {
          await createPeerConnection(peer, false, roomId)
        }
      }
      const signals = signalsRes.data?.data?.signals || []
      for (const signal of signals) {
        await handleSignal(signal)
      }
    } catch {}
  }

  function replaceOutgoingVideoTrack(track) {
    Object.values(peerConnectionsRef.current).forEach(pc => {
      const sender = pc.getSenders().find(item => item.track?.kind === 'video')
      if (sender) sender.replaceTrack(track)
    })
  }

  async function updateCallStatus(status) {
    if (!activeConversation && !activeCallRoom) return
    try {
      const res = await api.post('/team-chat.php?action=call', {
        conversation_id: activeConversation,
        room_id: activeCallRoom,
        status,
      })
      setCallStatus(res.data?.data?.call || null)
    } catch {}
  }

  async function startCall() {
    if (!activeConversation) return
    let roomId = activeCallRoom
    if (!roomId) {
      roomId = await inviteCall()
      if (!roomId) return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      setCallActive(true)
      setMicOn(true)
      setCameraOn(true)
      setActiveCallRoom(roomId)
      setSearchParams(roomId ? { conversation: activeConversation, room: roomId } : { conversation: activeConversation })
      await api.post('/team-chat.php?action=join', { room_id: roomId }).catch(() => {})
      await api.post('/team-chat.php?action=call', {
        conversation_id: activeConversation,
        room_id: roomId,
        status: 'joined',
      }).then(res => setCallStatus(res.data?.data?.call || null)).catch(() => {})
      if (callSyncTimeoutRef.current) {
        window.clearTimeout(callSyncTimeoutRef.current)
      }
      callSyncTimeoutRef.current = window.setTimeout(() => {
        syncCallRoom(roomId)
        callSyncTimeoutRef.current = null
      }, 300)
    } catch {
      toast('Allow camera and microphone permission to start the call', 'error')
    }
  }

  async function inviteCall() {
    if (inviteParticipantIds.length === 0) {
      toast(selectedConversation?.personId === 'hr' ? 'Employee-to-HR calling needs HR to start the call' : 'Select who can join this call', 'warning')
      return ''
    }

    setInviting(true)
    try {
      const res = await api.post('/team-chat.php?action=invite', {
        mode: callMode,
        participant_ids: inviteParticipantIds,
      })
      const room = res.data?.data?.room
      if (!room?.room_id) return ''
      setCallRooms(prev => [room, ...prev.filter(item => item.room_id !== room.room_id)])
      setActiveCallRoom(room.room_id)
      setSearchParams({ conversation: activeConversation, room: room.room_id })
      toast('Call invitation sent', 'success')
      return room.room_id
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to invite employees', 'error')
      return ''
    } finally {
      setInviting(false)
    }
  }

  function toggleParticipant(empId) {
    const id = String(empId)
    setSelectedParticipantIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  function endCall() {
    const roomId = activeCallRoom
    stopStream(localStreamRef.current)
    stopStream(screenStreamRef.current)
    localStreamRef.current = null
    screenStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    setCallActive(false)
    setScreenOn(false)
    closePeerConnections()
    if (roomId) api.post('/team-chat.php?action=leave', { room_id: roomId }).catch(() => {})
    updateCallStatus('left')
  }

  function toggleMic() {
    const next = !micOn
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = next })
    setMicOn(next)
    updateCallStatus(next ? 'unmuted' : 'muted')
  }

  function toggleCamera() {
    const next = !cameraOn
    localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = next })
    setCameraOn(next)
    updateCallStatus(next ? 'camera_on' : 'camera_off')
  }

  async function toggleScreenShare() {
    if (!callActive) {
      toast('Join the call before sharing your screen', 'warning')
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast('Screen share needs HTTPS or localhost in this browser', 'error')
      return
    }
    if (screenOn) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
      if (cameraTrack) replaceOutgoingVideoTrack(cameraTrack)
      if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current
      stopStream(screenStreamRef.current)
      screenStreamRef.current = null
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null
      setScreenOn(false)
      updateCallStatus('screen_stopped')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = stream
      if (screenVideoRef.current) screenVideoRef.current.srcObject = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      const screenTrack = stream.getVideoTracks()[0]
      if (screenTrack) replaceOutgoingVideoTrack(screenTrack)
      stream.getVideoTracks()[0].onended = () => {
        screenStreamRef.current = null
        setScreenOn(false)
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
        if (cameraTrack) replaceOutgoingVideoTrack(cameraTrack)
        if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current
        updateCallStatus('screen_stopped')
      }
      setScreenOn(true)
      updateCallStatus('screen_started')
    } catch (err) {
      const message = err?.name === 'NotAllowedError'
        ? 'Screen share permission was cancelled or blocked'
        : 'Screen share needs HTTPS/localhost and browser permission'
      toast(message, 'warning')
    }
  }

  function addAttachments(fileList) {
    const next = Array.from(fileList || []).slice(0, 10).map(file => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
    }))
    setAttachments(prev => [...prev, ...next].slice(0, 10))
  }

  function removeAttachment(index) {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  function copyMessage(text) {
    navigator.clipboard?.writeText(text || '')
    toast('Message copied', 'success')
  }

  function toggleStar(messageId) {
    setStarredMessages(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  function quickEmoji(value) {
    setDraft(prev => `${prev}${value}`)
    setShowEmojiPicker(false)
  }

  async function sendMessage(event) {
    event.preventDefault()
    const text = draft.trim()
    
    if (activeRoomId) {
      if (!text) return
      setDraft('')
      try {
        const res = await api.post('/team-chat.php?action=team_send_message', {
          room_id: activeRoomId,
          message: text
        })
        const saved = res.data?.data
        if (saved?.id) {
          setMessages(prev => [...prev, {
            id: saved.id,
            author_id: saved.sender_id,
            author: saved.sender_name,
            role: String(saved.sender_id) === 'hr' ? 'hr' : 'employee',
            text: saved.message,
            created_at: saved.created_at,
            profile_image: saved.sender_profile_image
          }])
        } else {
          loadMessages(false)
        }
      } catch {
        setDraft(text)
        toast('Message failed to send', 'error')
      }
      return
    }

    if (!text || !activeConversation) return
    setDraft('')
    try {
      const res = await api.post('/team-chat.php?action=message', {
        conversation_id: activeConversation,
        text,
        attachments: [],
        reply_to: null,
      })
      const saved = res.data?.data
      if (saved?.id) setMessages(prev => [...prev, saved])
      else loadMessages(false)
    } catch {
      setDraft(text)
      toast('Message failed to send', 'error')
    }
  }

  return (
    <div className="team-chat-page">
      <section className={`team-chat-shell ${mobileViewActive ? 'show-messages' : ''}`}>
        <aside className="team-room-panel">
          {/* ── Panel Header ── */}
          <div className="team-panel-header team-wa-panel-header">
            <div>
              <span className="team-kicker">{isHr ? 'Employee Connections' : 'Company Contacts'}</span>
              <h2>Chats</h2>
            </div>
            <MessageCircle size={20} />
          </div>

          {/* ── Search ── */}
          <div className="team-search">
            <Search size={14} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" />
          </div>

          {/* ── Tab Toggle ── */}
          <div style={{
            display: 'flex',
            gap: 4,
            padding: '0 8px 8px',
            borderBottom: '1px solid var(--border)',
            marginBottom: 4,
          }}>
            <button
              type="button"
              onClick={() => {
                setActiveRoomId(visibleTeamRooms[0]?.id || '')
                setActiveConversation('')
                if (visibleTeamRooms[0]) {
                  setSearchParams({ team_room: visibleTeamRooms[0].id })
                  setMobileViewActive(true)
                }
              }}
              style={{
                flex: 1,
                padding: '7px 0',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'all 0.15s',
                background: activeRoomId
                  ? 'var(--primary)'
                  : 'var(--bg-secondary)',
                color: activeRoomId
                  ? '#fff'
                  : 'var(--text-secondary)',
              }}
            >
              <Users size={13} />
              Groups
              {visibleTeamRooms.some(r => r.unread_count > 0) && (
                <span style={{
                  background: activeRoomId ? 'rgba(255,255,255,0.35)' : 'var(--primary)',
                  color: activeRoomId ? '#fff' : '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: '1px 6px',
                  minWidth: 18,
                }}>
                  {visibleTeamRooms.reduce((s, r) => s + (r.unread_count || 0), 0)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveRoomId('')
                const first = visibleConversations[0]
                if (first) {
                  setActiveConversation(first.id)
                  setSearchParams({ conversation: first.id })
                  setMobileViewActive(true)
                }
              }}
              style={{
                flex: 1,
                padding: '7px 0',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                transition: 'all 0.15s',
                background: !activeRoomId
                  ? 'var(--primary)'
                  : 'var(--bg-secondary)',
                color: !activeRoomId
                  ? '#fff'
                  : 'var(--text-secondary)',
              }}
            >
              <UserRound size={13} />
              Direct
              <span style={{
                background: !activeRoomId ? 'rgba(255,255,255,0.3)' : 'var(--bg-input)',
                color: !activeRoomId ? '#fff' : 'var(--text-muted)',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 10,
                padding: '1px 6px',
                border: '1px solid var(--border)',
              }}>
                {visibleConversations.length}
              </span>
            </button>
          </div>

          <div className="team-room-list" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflowY: 'auto',
            flex: 1,
            paddingBottom: 16,
          }}>

            {/* ════════ GROUPS TAB ════════ */}
            {activeRoomId !== undefined && (
              <>
                {/* Group rooms — always rendered but hidden via display when DM tab is "selected"
                    We use CSS display so we don't lose scroll position on tab switch */}
                {visibleTeamRooms.length === 0 ? (
                  activeRoomId === '' ? null : (
                    <div className="team-empty-state compact" style={{ marginTop: 20 }}>
                      <Users size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                      <p style={{ fontSize: 13, margin: 0 }}>No group rooms yet</p>
                      <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Department chats appear here</small>
                    </div>
                  )
                ) : null}
              </>
            )}

            {/* GROUPS list — visible when activeRoomId is set OR no conversation is active yet */}
            {activeRoomId
              ? visibleTeamRooms.map(room => {
                  const isActive = activeRoomId === room.id
                  const hue = (room.department?.charCodeAt(0) || 0) * 17 % 360
                  return (
                    <button
                      key={room.id}
                      className={`team-room-item ${isActive ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        setActiveRoomId(room.id)
                        setActiveConversation('')
                        setActiveCallRoom('')
                        setSearchParams({ team_room: room.id })
                        setMobileViewActive(true)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '9px 10px',
                        borderRadius: 10,
                        textAlign: 'left',
                        background: isActive
                          ? 'linear-gradient(135deg, #f26a00 0%, #ff9a3c 100%)'
                          : 'transparent',
                        boxShadow: isActive ? '0 4px 16px rgba(242,106,0,0.35)' : 'none',
                        borderLeft: isActive ? '4px solid #fff5' : '4px solid transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                        background: isActive ? 'rgba(255,255,255,0.18)' : `hsl(${hue},70%,80%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Users size={17} style={{ color: isActive ? '#fff' : `hsl(${hue},60%,40%)` }} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 700, fontSize: 13, lineHeight: 1.2,
                          color: isActive ? '#fff' : 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {room.name || `${room.department} Team`}
                        </div>
                        <div style={{
                          fontSize: 11, marginTop: 2,
                          color: isActive ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {room.latest_message_preview || 'No messages yet'}
                        </div>
                      </div>

                      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {room.unread_count > 0 && (
                          <span style={{
                            background: isActive ? '#fff' : 'var(--primary)',
                            color: isActive ? 'var(--primary)' : '#fff',
                            fontSize: 10, fontWeight: 800,
                            borderRadius: 12, minWidth: 18, height: 18,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                          }}>
                            {room.unread_count}
                          </span>
                        )}
                        <small style={{
                          fontSize: 10,
                          color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
                        }}>
                          {room.member_count || 0} members
                        </small>
                      </div>
                    </button>
                  )
                })
              : null
            }

            {/* ════════ DIRECT MESSAGES TAB ════════ */}
            {!activeRoomId
              ? (loadingPeople
                ? (
                  <div className="team-empty-state compact" style={{ marginTop: 20 }}>
                    <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 8px' }} />
                    <p style={{ fontSize: 13, margin: 0, color: 'var(--text-muted)' }}>Loading contacts…</p>
                  </div>
                )
                : visibleConversations.length === 0
                ? (
                  <div className="team-empty-state compact" style={{ marginTop: 20 }}>
                    <UserRound size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                    <p style={{ fontSize: 13, margin: 0 }}>No contacts found</p>
                  </div>
                )
                : visibleConversations.map(item => {
                    const isActive = activeConversation === item.id
                    const initials = initialsFromName(item.name)
                    const hue = (item.name?.charCodeAt(0) || 0) * 13 % 360
                    return (
                      <button
                        key={item.id}
                        className={`team-room-item ${isActive ? 'active' : ''}`}
                        type="button"
                        onClick={() => {
                          setActiveConversation(item.id)
                          setActiveRoomId('')
                          setActiveCallRoom('')
                          setSearchParams({ conversation: item.id })
                          setMobileViewActive(true)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '9px 10px',
                          borderRadius: 10,
                          textAlign: 'left',
                          background: isActive
                            ? 'linear-gradient(135deg, #f26a00 0%, #ff9a3c 100%)'
                            : 'transparent',
                          boxShadow: isActive ? '0 4px 16px rgba(242,106,0,0.35)' : 'none',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                          background: isActive ? 'rgba(255,255,255,0.2)' : `hsl(${hue},60%,55%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 13,
                          color: '#fff',
                        }}>
                          {initials}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: 700, fontSize: 13, lineHeight: 1.2,
                            color: isActive ? '#fff' : 'var(--text)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {item.name}
                          </div>
                          <div style={{
                            fontSize: 11, marginTop: 2,
                            color: isActive ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {item.desc}
                          </div>
                        </div>

                        {item.type === 'hr' && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px',
                            borderRadius: 8,
                            background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(99,102,241,0.12)',
                            color: isActive ? '#fff' : 'var(--primary)',
                            flexShrink: 0,
                          }}>HR</span>
                        )}
                      </button>
                    )
                  })
              )
              : null
            }

          </div>
        </aside>

        <main className="team-message-panel">
          <div className="team-chat-header team-wa-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {mobileViewActive && (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary mobile-back-btn"
                  onClick={() => setMobileViewActive(false)}
                  style={{ display: 'none', alignItems: 'center', gap: 4, marginRight: 12, padding: '6px 12px', fontSize: 12 }}
                >
                  Chats
                </button>
              )}
              {activeRoomId ? (
                <div>
                  <span className="team-kicker">Team Group</span>
                  <h2>{selectedTeamRoom?.name || 'Department Room'}</h2>
                  <p>{selectedTeamRoom?.department ? `${selectedTeamRoom.department} members with HR included.` : 'Collaborating with your department members.'}</p>
                </div>
              ) : (
                <div>
                  <span className="team-kicker">Private Conversation</span>
                  <h2>{selectedConversation?.name || 'Select an employee'}</h2>
                  <p>{selectedConversation?.desc || 'Choose a connection to start chatting.'}</p>
                </div>
              )}
            </div>
            <div className="team-header-meta team-wa-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  loadMessages(true)
                  loadTeamRooms()
                }}
                className="btn btn-sm btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 8 }}
                title="Refresh Chat"
                aria-label="Refresh Chat"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          <div className="team-message-list">
            {hasMoreMessages && !loadingMessages && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (loadingOlderMessages || messages.length === 0) return
                    const oldestId = messages[0]?.id
                    if (!oldestId) return
                    setLoadingOlderMessages(true)
                    loadMessages(false, oldestId)
                  }}
                  disabled={loadingOlderMessages}
                  style={{
                    padding: '5px 16px', fontSize: 11, borderRadius: 20,
                    border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: 6,
                  }}
                >
                  {loadingOlderMessages
                    ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Loading…</>
                    : '↑ Load older messages'
                  }
                </button>
              </div>
            )}
            {loadingMessages ? (
              <div className="team-empty-state">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="team-empty-state">No messages yet. Start this conversation.</div>
            ) : messages.map(message => {
              const mine = String(message.author_id) === currentUserId
              return (
                <article key={message.id} className={`team-message ${mine ? 'mine' : ''}`}>
                  <div className="team-avatar">{initialsFromName(message.author)}</div>
                  <div className="team-bubble">
                    <div className="team-message-meta">
                      <strong>{message.author}</strong>
                      <span>{message.role === 'hr' ? 'HR Admin' : 'Employee'}</span>
                      <time>{formatTime(message.created_at)}</time>
                      {mine && <CheckCheck size={12} />}
                    </div>
                    {message.text && <p>{message.text}</p>}
                  </div>
                </article>
              )
            })}
            <div ref={messagesEndRef} />
          </div>


          <form className="team-composer" onSubmit={sendMessage}>
            <button
              className="team-emoji-trigger"
              type="button"
              title="Emoji"
              aria-label="Emoji picker"
              onClick={() => setShowEmojiPicker(prev => !prev)}
            >
              <Smile size={20} />
            </button>
            {showEmojiPicker && (
              <div className="team-emoji-picker">
                {['😀', '😂', '😊', '👍', '🙏', '❤️', '🎉', '✅', '🔥', '👏', '😅', '👌'].map(emoji => (
                  <button key={emoji} type="button" onClick={() => quickEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={
                activeRoomId
                  ? `Message ${selectedTeamRoom?.name || 'room'}`
                  : selectedConversation
                  ? `Message ${selectedConversation.name}`
                  : 'Select an employee'
              }
              disabled={!activeRoomId && !selectedConversation}
              style={{ paddingRight: '40px' }}
            />
            <button className="btn btn-primary btn-icon" type="submit" title="Send message" aria-label="Send message" disabled={(!activeRoomId && !selectedConversation) || !draft.trim()}>
              <Send size={16} />
            </button>
          </form>
        </main>

      </section>
    </div>
  )
}
