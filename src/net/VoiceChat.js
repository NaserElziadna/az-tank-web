import { log } from '../core/log/Logger.js';

const vlog = log.scope('voice');
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/**
 * Peer-to-peer voice chat for a room, as a small WebRTC mesh. Signaling
 * (hello / offer / answer / ice) is relayed through the game WebSocket by slot.
 * Voice is opt-in: nothing happens until enable() grabs the mic. Two independent
 * toggles — mute (stop sending my audio) and deafen (stop hearing everyone).
 *
 * Glare-free: for any enabled pair, the LOWER slot creates the offer.
 */
export class VoiceChat {
  /** @param {import('./NetClient.js').NetClient} net @param {number} mySlot */
  constructor(net, mySlot) {
    this.net = net;
    this.mySlot = mySlot;
    this.localStream = null;
    this.enabled = false;
    this.muted = false;
    this.deafened = false;
    this.roster = new Set(); // other members' slots currently in the room
    this.enabledPeers = new Set(); // slots that announced voice
    this._helloed = new Set();
    /** @type {Map<number, {pc:RTCPeerConnection, audioEl:HTMLAudioElement}>} */
    this.peers = new Map();
    this._off = net.on('rtc', (m) => this._onSignal(m));
  }

  /** Grab the mic and join the voice mesh. Returns false if permission denied. */
  async enable() {
    if (this.enabled) return true;
    vlog.info('enable() called', { hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), secure: window.isSecureContext });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia unavailable (insecure context?)');
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (e) {
      vlog.warn('mic permission denied', { error: e?.message });
      return false;
    }
    this.enabled = true;
    this.setMuted(this.muted); // apply current mute state to the fresh track
    vlog.info('voice enabled', { mySlot: this.mySlot, peers: [...this.roster] });
    for (const slot of this.roster) this._sendHello(slot);
    return true;
  }

  /** Update the set of other members present (from roomState). */
  setRoster(slots) {
    this.roster = new Set(slots.filter((s) => s !== this.mySlot));
    // Drop connections to members who left.
    for (const slot of [...this.peers.keys()]) {
      if (!this.roster.has(slot)) this._dropPeer(slot);
    }
    if (this.enabled) for (const slot of this.roster) this._sendHello(slot);
  }

  setMuted(b) {
    this.muted = b;
    if (this.localStream) for (const t of this.localStream.getAudioTracks()) t.enabled = !b;
  }

  setDeafened(b) {
    this.deafened = b;
    for (const { audioEl } of this.peers.values()) audioEl.muted = b;
  }

  // ── signaling ──────────────────────────────────────────────────────────────
  _sendHello(slot) {
    if (this._helloed.has(slot)) return;
    this._helloed.add(slot);
    this.net.sendRtc(slot, 'hello', null);
  }

  _onSignal(m) {
    const slot = m.fromSlot;
    if (slot == null || slot === this.mySlot) return;
    switch (m.kind) {
      case 'hello':
        this.enabledPeers.add(slot);
        if (this.enabled) this._sendHello(slot); // let them know we're here too
        this._maybeConnect(slot);
        break;
      case 'offer':
        this._onOffer(slot, m.payload);
        break;
      case 'answer': {
        const peer = this.peers.get(slot);
        if (peer) peer.pc.setRemoteDescription(m.payload).catch((e) => vlog.warn('setRemote(answer) failed', e));
        break;
      }
      case 'ice': {
        const peer = this.peers.get(slot);
        if (peer && m.payload) peer.pc.addIceCandidate(m.payload).catch(() => {});
        break;
      }
      default:
        break;
    }
  }

  /** Lower slot offers; higher slot waits for the offer. */
  _maybeConnect(slot) {
    if (!this.enabled || !this.enabledPeers.has(slot) || this.peers.has(slot)) return;
    if (this.mySlot < slot) {
      const peer = this._createPeer(slot);
      peer.pc
        .createOffer()
        .then((o) => peer.pc.setLocalDescription(o))
        .then(() => this.net.sendRtc(slot, 'offer', peer.pc.localDescription))
        .catch((e) => vlog.warn('createOffer failed', e));
    }
  }

  async _onOffer(slot, offer) {
    const peer = this.peers.get(slot) || this._createPeer(slot);
    try {
      await peer.pc.setRemoteDescription(offer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.net.sendRtc(slot, 'answer', peer.pc.localDescription);
    } catch (e) {
      vlog.warn('answer failed', { slot, error: e?.message });
    }
  }

  _createPeer(slot) {
    const pc = new RTCPeerConnection(ICE);
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.muted = this.deafened;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    if (this.localStream) for (const t of this.localStream.getTracks()) pc.addTrack(t, this.localStream);
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      audioEl.play?.().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.sendRtc(slot, 'ice', e.candidate);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this._dropPeer(slot);
    };
    const peer = { pc, audioEl };
    this.peers.set(slot, peer);
    vlog.info('peer created', { slot, initiator: this.mySlot < slot });
    return peer;
  }

  _dropPeer(slot) {
    const peer = this.peers.get(slot);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {
      /* ignore */
    }
    peer.audioEl.srcObject = null;
    peer.audioEl.remove();
    this.peers.delete(slot);
    this._helloed.delete(slot);
  }

  dispose() {
    this._off?.();
    for (const slot of [...this.peers.keys()]) this._dropPeer(slot);
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    this.localStream = null;
    this.enabled = false;
  }
}
