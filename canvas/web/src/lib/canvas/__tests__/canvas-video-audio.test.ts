import { describe, expect, it } from "vitest";
import { audioBufferToWav } from "../canvas-video-audio";

describe("canvas-video-audio", () => {
    it("encodes AudioBuffer into a valid 16-bit PCM WAV blob", async () => {
        const sampleRate = 44100;
        const length = 100;
        const channelData = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            channelData[i] = Math.sin((i / length) * Math.PI * 2);
        }

        const fakeBuffer = {
            numberOfChannels: 1,
            sampleRate,
            length,
            duration: length / sampleRate,
            getChannelData: () => channelData,
            copyFromChannel: () => {},
            copyToChannel: () => {},
        } as unknown as AudioBuffer;

        const wavBlob = audioBufferToWav(fakeBuffer);
        expect(wavBlob).toBeInstanceOf(Blob);
        expect(wavBlob.type).toBe("audio/wav");

        // Header: 44 bytes + 100 samples * 1 channel * 2 bytes = 244 bytes
        expect(wavBlob.size).toBe(44 + length * 2);

        const arrayBuffer = await wavBlob.arrayBuffer();
        const view = new DataView(arrayBuffer);

        // RIFF header
        const textDecoder = new TextDecoder();
        expect(textDecoder.decode(arrayBuffer.slice(0, 4))).toBe("RIFF");
        expect(view.getUint32(4, true)).toBe(36 + length * 2);
        expect(textDecoder.decode(arrayBuffer.slice(8, 12))).toBe("WAVE");
        expect(textDecoder.decode(arrayBuffer.slice(12, 16))).toBe("fmt ");
        expect(view.getUint16(20, true)).toBe(1); // PCM
        expect(view.getUint16(22, true)).toBe(1); // 1 channel
        expect(view.getUint32(24, true)).toBe(sampleRate);
        expect(textDecoder.decode(arrayBuffer.slice(36, 40))).toBe("data");
        expect(view.getUint32(40, true)).toBe(length * 2);
    });
});
