/**
 * Empathic Art — Muse Web Bluetooth transport
 *
 * Speaks the Interaxon Muse GATT protocol directly. This repo has no build
 * step, so we cannot import `muse-js` (npm + rxjs); the protocol itself is
 * small enough to carry in-tree, and doing so keeps the zero-dependency
 * deploy story intact. Behaviour matches muse-js for the characteristics we
 * use: same control commands, same 12-bit EEG unpacking, same µV scaling.
 *
 * Supported hardware: Muse 2016, Muse 2, Muse S (all expose service 0xFE8D).
 *
 * Web Bluetooth is Chrome/Edge/Chrome-Android only. It is NOT available in
 * iOS Safari or WKWebView — on the iPhone build the CoreBluetooth bridge in
 * INTEGRATION.md registers its own adapter instead and this file is unused.
 *
 * @author  Bob Dougherty
 * @license MIT for source code (see LICENSE); artwork, brand, and generated outputs licensed separately under ARTWORK-LICENSE.md. See NOTICE.md.
 */

const MUSE_SERVICE = "0000fe8d-0000-1000-8000-00805f9b34fb";

/**
 * Every Muse characteristic is `273e00NN` against this base, verified by
 * enumerating a Muse S: the service exposes exactly 18 characteristics,
 * `273e0001`–`273e0012`, all sharing this suffix. Build them from one
 * constant so a transcription slip cannot affect just one of them.
 */
const MUSE_UUID_BASE = "4c4d-454d-96be-f03bac821358";
const museChar = (n) => `273e${n.toString(16).padStart(4, "0")}-${MUSE_UUID_BASE}`;

const CHAR = {
  control:   museChar(0x01),
  telemetry: museChar(0x0b),
  // EEG electrodes, in the channel order the rest of the pipeline assumes.
  eeg: [
    museChar(0x03), // TP9  — left ear
    museChar(0x04), // AF7  — left forehead
    museChar(0x05), // AF8  — right forehead
    museChar(0x06), // TP10 — right ear
  ],
};

/** Electrode names by channel index — used for labels and asymmetry maths. */
export const CHANNEL_NAMES = ["TP9", "AF7", "AF8", "TP10"];

/** Index of the frontal electrodes, the pair frontal-alpha-asymmetry needs. */
export const AF7 = 1;
export const AF8 = 2;

/** Muse EEG sample rate (Hz). Fixed by the hardware. */
export const EEG_FS = 256;

/** µV per LSB of the 12-bit ADC (same constant muse-js uses). */
const EEG_SCALE = 0.48828125;

/**
 * Unpack 18 bytes into 12 unsigned 12-bit words, then convert to µV.
 * The Muse packs samples back-to-back with no byte alignment: every 3 bytes
 * carry 2 samples.
 *
 * @param {DataView} view — a 20-byte EEG notification
 * @returns {number[]} 12 samples in µV, oldest first
 */
function decodeEEGPacket(view) {
  const out = new Array(12);
  let o = 0;
  // Bytes 0–1 are the packet sequence number; samples start at byte 2.
  for (let i = 2; i < 20; i += 3) {
    const b0 = view.getUint8(i);
    const b1 = view.getUint8(i + 1);
    const b2 = view.getUint8(i + 2);
    out[o++] = EEG_SCALE * (((b0 << 4) | (b1 >> 4)) - 0x800);
    out[o++] = EEG_SCALE * ((((b1 & 0x0f) << 8) | b2) - 0x800);
  }
  return out;
}

/** Encode a Muse control command as its length-prefixed, newline-terminated form. */
function encodeCommand(cmd) {
  const bytes = new Uint8Array(cmd.length + 2);
  bytes[0] = cmd.length + 1;
  for (let i = 0; i < cmd.length; i++) bytes[i + 1] = cmd.charCodeAt(i);
  bytes[cmd.length + 1] = 0x0a; // '\n'
  return bytes;
}

/** True when this browser exposes Web Bluetooth at all. */
export function isWebBluetoothAvailable() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

/**
 * A connected (or connectable) Muse headband.
 *
 * Lifecycle: `requestMuseDevice()` → `client.connect()` → notifications flow
 * to the callbacks below → `client.disconnect()`.
 *
 * Callbacks (assign directly, all optional):
 *   onEEG(channelIndex, samples)  — 12 µV samples, ~21×/s per channel
 *   onBattery(percent)            — ~every 10 s
 *   onDisconnect()                — hardware- or user-initiated drop
 */
export class MuseClient {
  constructor(device) {
    this.device = device;
    this.deviceName = device?.name ?? "Muse";
    this.isConnected = false;
    this.batteryLevel = null;

    this.onEEG = null;
    this.onBattery = null;
    this.onDisconnect = null;

    this._server = null;
    this._control = null;
    this._notifying = [];
    this._onGattDisconnected = () => this._handleDisconnect();
  }

  /**
   * Connect GATT, subscribe to the EEG + telemetry characteristics, start
   * streaming.
   *
   * Every step is logged. Bluetooth failures are hard to reproduce and the
   * error names are ambiguous (`NotFoundError` alone covers a missing
   * service, a missing characteristic, and a dismissed picker), so knowing
   * which step was in flight is usually the whole diagnosis.
   */
  async connect() {
    const step = (msg) => console.info(`[muse-ble] ${msg}`);

    this.device.addEventListener("gattserverdisconnected", this._onGattDisconnected);
    step(`connecting GATT to "${this.deviceName}"…`);
    this._server = await this.device.gatt.connect();

    step("GATT connected, discovering the Muse service…");
    let service;
    try {
      service = await this._server.getPrimaryService(MUSE_SERVICE);
    } catch (err) {
      throw new Error(
        `Muse service ${MUSE_SERVICE} not found on "${this.deviceName}" (${err?.name}). ` +
        `The device paired but does not expose the expected service.`,
        { cause: err },
      );
    }

    step("service found, subscribing to control…");
    this._control = await service.getCharacteristic(CHAR.control);
    await this._control.startNotifications().catch(() => {}); // control replies are informational

    for (let ch = 0; ch < CHAR.eeg.length; ch++) {
      const c = await service.getCharacteristic(CHAR.eeg[ch]);
      c.addEventListener("characteristicvaluechanged", (ev) => {
        if (this.onEEG) this.onEEG(ch, decodeEEGPacket(ev.target.value));
      });
      await c.startNotifications();
      this._notifying.push(c);
      step(`EEG channel ${ch} (${CHANNEL_NAMES[ch]}) subscribed`);
    }

    try {
      const tel = await service.getCharacteristic(CHAR.telemetry);
      tel.addEventListener("characteristicvaluechanged", (ev) => {
        // Word 1 is the battery level in 1/512 %.
        this.batteryLevel = Math.round(ev.target.value.getUint16(2) / 512);
        if (this.onBattery) this.onBattery(this.batteryLevel);
      });
      await tel.startNotifications();
      this._notifying.push(tel);
      step("telemetry subscribed");
    } catch (err) {
      // Telemetry is a nicety — a headband that will not surface it still streams EEG.
      console.warn("[muse-ble] telemetry unavailable, continuing without battery level", err);
    }

    this.isConnected = true;

    // Halt, select the EEG-only preset, then resume. Matches muse-js's start().
    step("sending start commands (h, p21, s, d)…");
    await this._send("h");
    await this._send("p21");
    await this._send("s");
    await this._send("d");
    step("streaming.");
  }

  /** Stop streaming and drop the GATT link. */
  async disconnect() {
    try { await this._send("h"); } catch { /* already gone */ }
    this.device?.removeEventListener("gattserverdisconnected", this._onGattDisconnected);
    for (const c of this._notifying) {
      try { await c.stopNotifications(); } catch { /* ignore */ }
    }
    this._notifying = [];
    try { this.device?.gatt?.disconnect(); } catch { /* ignore */ }
    this._handleDisconnect();
  }

  async _send(cmd) {
    if (!this._control) return;
    await this._control.writeValue(encodeCommand(cmd));
  }

  _handleDisconnect() {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.batteryLevel = null;
    if (this.onDisconnect) this.onDisconnect();
  }
}

/**
 * Thrown when the user dismisses the device picker without choosing anything.
 *
 * This exists because Chrome reports that dismissal as a `NotFoundError` —
 * the exact same error name `getPrimaryService()` throws when it cannot
 * resolve a service on a device that DID pair. Callers want to stay quiet
 * about the former and shout about the latter, so the two must be
 * distinguishable by more than the name Web Bluetooth gives them.
 */
export class MusePickerCancelled extends Error {
  constructor() {
    super("Device picker dismissed.");
    this.name = "MusePickerCancelled";
  }
}

/**
 * Show the browser's device picker and return an unconnected MuseClient.
 *
 * MUST be called synchronously from a user gesture (a click handler) —
 * Web Bluetooth rejects the request otherwise. Throws `MusePickerCancelled`
 * if the user dismisses the picker; anything else is a real failure.
 *
 * @returns {Promise<MuseClient>}
 */
export async function requestMuseDevice() {
  if (!isWebBluetoothAvailable()) {
    throw new Error("Web Bluetooth is unavailable in this browser.");
  }
  let device;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MUSE_SERVICE] }, { namePrefix: "Muse" }],
      optionalServices: [MUSE_SERVICE],
    });
  } catch (err) {
    if (err?.name === "NotFoundError") throw new MusePickerCancelled();
    throw err;
  }
  return new MuseClient(device);
}
