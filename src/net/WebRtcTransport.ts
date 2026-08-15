import {
  decodeBinary,
  encodeChecksum,
  encodeInput,
  type SignalPayload,
} from './protocol';
import type { ChecksumMessage, InputMessage, Transport } from './Transport';

/**
 * Gameplay traffic over a direct peer connection.
 *
 * The whole point is to stop routing every keypress through a datacentre. Two
 * players in the same country are perhaps 10-15 ms apart directly, but 60 ms
 * apart via a relay in another one — and that difference is doubled into the
 * input delay, because a frame has to arrive before the tick that needs it.
 *
 * The channel is deliberately unreliable and unordered. Lockstep does not want
 * TCP's retransmissions: a frame that arrives late is useless, and the protocol
 * already repeats recent frames in every message. That redundancy is tested
 * against 20% packet loss, so dropping the delivery guarantees costs nothing and
 * removes head-of-line blocking.
 */

/** Public STUN only. When traversal fails the match falls back to the relay, so
 *  there is no TURN server to pay for. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const CHANNEL_LABEL = 'meme-cat-fighter';

export class WebRtcTransport implements Transport {
  private inputHandler: ((message: InputMessage) => void) | null = null;
  private checksumHandler: ((message: ChecksumMessage) => void) | null = null;

  constructor(private readonly channel: RTCDataChannel) {
    this.channel.binaryType = 'arraybuffer';
    this.channel.addEventListener('message', (event: MessageEvent) => this.receive(event.data));
  }

  sendInput(message: InputMessage): void {
    this.send(encodeInput(message));
  }

  sendChecksum(message: ChecksumMessage): void {
    this.send(encodeChecksum(message));
  }

  onInput(handler: (message: InputMessage) => void): void {
    this.inputHandler = handler;
  }

  onChecksum(handler: (message: ChecksumMessage) => void): void {
    this.checksumHandler = handler;
  }

  private send(bytes: Uint8Array): void {
    if (this.channel.readyState !== 'open') return;
    // Copied into a plain ArrayBuffer: RTCDataChannel.send does not accept a view
    // whose backing buffer might be shared.
    const payload = bytes.slice().buffer as ArrayBuffer;
    // A closing channel throws rather than dropping; the match should not end
    // because the opponent's browser is shutting down a tick early.
    try {
      this.channel.send(payload);
    } catch {
      /* the session's own stall handling covers this */
    }
  }

  private receive(data: unknown): void {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return;
    const packet = decodeBinary(data as ArrayBuffer);
    if (!packet) return;
    if (packet.kind === 'input') {
      this.inputHandler?.({ startTick: packet.startTick, frames: packet.frames });
    } else {
      this.checksumHandler?.({ tick: packet.tick, hash: packet.hash });
    }
  }
}

export interface PeerConnectionHandle {
  /** Resolves with an open channel, or null if the attempt gave up. */
  channel: Promise<RTCDataChannel | null>;
  /** Feed a negotiation blob that arrived from the other player. */
  accept(payload: SignalPayload): void;
  close(): void;
}

export interface PeerOptions {
  /** Seat 0 offers, seat 1 answers. A fixed assignment avoids both sides offering. */
  isOfferer: boolean;
  sendSignal(payload: SignalPayload): void;
  iceServers?: RTCIceServer[];
  timeoutMs?: number;
}

/** How long to keep trying before settling for the relay. */
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Start negotiating a peer connection.
 *
 * Returns immediately with a handle; the caller decides how long to wait and what
 * to do if it never opens.
 */
export function connectPeer(options: PeerOptions): PeerConnectionHandle {
  const connection = new RTCPeerConnection({
    iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
  });

  let settle: (channel: RTCDataChannel | null) => void = () => {};
  const channel = new Promise<RTCDataChannel | null>((resolve) => { settle = resolve; });
  let settled = false;
  const finish = (value: RTCDataChannel | null) => {
    if (settled) return;
    settled = true;
    settle(value);
  };

  const timer = setTimeout(() => finish(null), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const adopt = (dataChannel: RTCDataChannel) => {
    dataChannel.binaryType = 'arraybuffer';
    if (dataChannel.readyState === 'open') {
      clearTimeout(timer);
      finish(dataChannel);
      return;
    }
    dataChannel.addEventListener('open', () => {
      clearTimeout(timer);
      finish(dataChannel);
    });
  };

  connection.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    options.sendSignal({ kind: 'candidate', data: JSON.stringify(event.candidate.toJSON()) });
  });

  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed') finish(null);
  });

  if (options.isOfferer) {
    // Unreliable and unordered: see the note on WebRtcTransport.
    adopt(connection.createDataChannel(CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 }));
    void (async () => {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      options.sendSignal({ kind: 'offer', data: JSON.stringify(connection.localDescription) });
    })();
  } else {
    connection.addEventListener('datachannel', (event) => adopt(event.channel));
  }

  // Candidates routinely arrive before the description they belong to; holding
  // them avoids an error that would abandon an otherwise workable connection.
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const drainCandidates = async () => {
    while (pendingCandidates.length > 0) {
      const candidate = pendingCandidates.shift()!;
      try { await connection.addIceCandidate(candidate); } catch { /* stale candidate */ }
    }
  };

  const accept = (payload: SignalPayload): void => {
    void (async () => {
      try {
        if (payload.kind === 'offer') {
          await connection.setRemoteDescription(JSON.parse(payload.data) as RTCSessionDescriptionInit);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          options.sendSignal({ kind: 'answer', data: JSON.stringify(connection.localDescription) });
          await drainCandidates();
        } else if (payload.kind === 'answer') {
          await connection.setRemoteDescription(JSON.parse(payload.data) as RTCSessionDescriptionInit);
          await drainCandidates();
        } else if (payload.kind === 'candidate') {
          const candidate = JSON.parse(payload.data) as RTCIceCandidateInit;
          if (connection.remoteDescription) await connection.addIceCandidate(candidate);
          else pendingCandidates.push(candidate);
        }
      } catch {
        finish(null);
      }
    })();
  };

  return {
    channel,
    accept,
    close: () => {
      clearTimeout(timer);
      finish(null);
      connection.close();
    },
  };
}
