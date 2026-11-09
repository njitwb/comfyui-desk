import { getMediaBlob } from "@/services/file-storage";

export function audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataByteCount = buffer.length * blockAlign;
    const headerByteCount = 44;
    const totalByteCount = headerByteCount + dataByteCount;

    const arrayBuffer = new ArrayBuffer(totalByteCount);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    // ChunkID "RIFF"
    writeString(0, "RIFF");
    // ChunkSize = 36 + SubChunk2Size
    view.setUint32(4, 36 + dataByteCount, true);
    // Format "WAVE"
    writeString(8, "WAVE");

    // Subchunk1ID "fmt "
    writeString(12, "fmt ");
    // Subchunk1Size = 16 for PCM
    view.setUint32(16, 16, true);
    // AudioFormat = 1 (PCM)
    view.setUint16(20, format, true);
    // NumChannels
    view.setUint16(22, numChannels, true);
    // SampleRate
    view.setUint32(24, sampleRate, true);
    // ByteRate = SampleRate * NumChannels * BitsPerSample/8
    view.setUint32(28, sampleRate * blockAlign, true);
    // BlockAlign = NumChannels * BitsPerSample/8
    view.setUint16(32, blockAlign, true);
    // BitsPerSample = 16
    view.setUint16(34, bitDepth, true);

    // Subchunk2ID "data"
    writeString(36, "data");
    // Subchunk2Size
    view.setUint32(40, dataByteCount, true);

    // Interleave samples
    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
        channels.push(buffer.getChannelData(c));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let c = 0; c < numChannels; c++) {
            const sample = Math.max(-1, Math.min(1, channels[c][i]));
            const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(offset, int16, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
}

export async function extractAudioFromVideo(videoUrl: string, storageKey?: string): Promise<Blob> {
    let arrayBuffer: ArrayBuffer | undefined;

    if (storageKey) {
        const storedBlob = await getMediaBlob(storageKey);
        if (storedBlob) {
            arrayBuffer = await storedBlob.arrayBuffer();
        }
    }

    if (!arrayBuffer) {
        const response = await fetch(videoUrl);
        if (!response.ok) {
            throw new Error("FAILED_TO_FETCH_VIDEO");
        }
        arrayBuffer = await response.arrayBuffer();
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
        throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    }

    const audioCtx = new AudioContextClass();
    try {
        const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
            audioCtx.decodeAudioData(
                arrayBuffer!.slice(0),
                (decoded) => resolve(decoded),
                (err) => reject(err),
            );
        });

        if (!audioBuffer || audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
            throw new Error("NO_AUDIO_TRACK");
        }

        return audioBufferToWav(audioBuffer);
    } catch (error) {
        if (error instanceof Error && error.message === "AUDIO_CONTEXT_UNSUPPORTED") {
            throw error;
        }
        throw new Error("NO_AUDIO_TRACK");
    } finally {
        void audioCtx.close();
    }
}
