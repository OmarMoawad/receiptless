"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type QRScannerProps = {
  onDecode: (payload: string) => void;
};

export default function QRScanner({ onDecode }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frameId: number;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        tick();
      } catch {
        setError(
          "Camera unavailable. Grant camera permission or use photo upload below."
        );
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            onDecode(code.data);
            return;
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDecode]);

  return (
    <div className="flex flex-col items-center gap-2">
      <video
        ref={videoRef}
        className="w-full max-w-sm rounded-lg bg-black"
        muted
        playsInline
      />
      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {scanning && !error && (
        <p className="text-sm text-neutral-500">Point at a receipt QR code…</p>
      )}
    </div>
  );
}
