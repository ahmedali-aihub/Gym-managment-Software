import { Camera, RefreshCw, Upload, User, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Member photo capture.
 *
 * Two paths, because both happen at a real front desk: a webcam for members
 * registering in person, and a file upload for anyone registering over the
 * phone who sends a photo later.
 *
 * The camera stream is torn down on unmount and on capture. Leaving it open
 * keeps the laptop's camera light on after the form closes, which reads as
 * surveillance and is the kind of thing a member will notice and mention.
 */

interface PhotoCaptureProps {
  /** Base64 data URL, or null when no photo has been taken. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  className?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
/** Square output — ID cards and avatars are all 1:1. */
const OUTPUT_SIZE = 640;

export function PhotoCapture({ value, onChange, className }: PhotoCaptureProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isStreaming, setIsStreaming] = React.useState(false);
  const [isStarting, setIsStarting] = React.useState(false);

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  }, []);

  // Release the camera when the component goes away, whatever the reason.
  React.useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setIsStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setIsStreaming(true);

      // The <video> only exists once isStreaming flips, so wait a frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (error) {
      // Distinguish a refusal from a missing device — the fixes differ.
      const name = (error as DOMException)?.name;

      if (name === 'NotAllowedError') {
        toast.error('Camera access was denied', {
          description:
            'Allow camera access in your browser settings, or upload a photo instead.',
        });
      } else if (name === 'NotFoundError') {
        toast.error('No camera found', {
          description: 'Upload a photo from this device instead.',
        });
      } else {
        toast.error('Could not start the camera', {
          description: 'Upload a photo from this device instead.',
        });
      }
    } finally {
      setIsStarting(false);
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Centre-crop to a square. Drawing the full frame into a square canvas
    // would stretch faces, which on an ID photo is both ugly and unhelpful.
    const { videoWidth: w, videoHeight: h } = video;
    const side = Math.min(w, h);
    const sx = (w - side) / 2;
    const sy = (h - side) / 2;

    // Mirror horizontally: the preview is mirrored (as users expect), so an
    // unmirrored capture would surprise them with a flipped photo.
    context.translate(OUTPUT_SIZE, 0);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    onChange(canvas.toDataURL('image/jpeg', 0.88));
    stopCamera();
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image');
      return;
    }

    if (file.size > MAX_BYTES) {
      toast.error('Image is too large', {
        description: 'Please choose a file under 5 MB.',
      });
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        // Re-encode to the same square JPEG the camera produces, so every
        // member photo is consistent regardless of how it arrived.
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;

        const context = canvas.getContext('2d');
        if (!context) return;

        const side = Math.min(image.width, image.height);
        const sx = (image.width - side) / 2;
        const sy = (image.height - side) / 2;

        context.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
        onChange(canvas.toDataURL('image/jpeg', 0.88));
      };

      image.src = reader.result as string;
    };

    reader.readAsDataURL(file);

    // Reset so selecting the same file twice still fires a change event.
    event.target.value = '';
  }

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div
        className={cn(
          'relative flex size-36 items-center justify-center overflow-hidden rounded-2xl',
          'border border-border bg-muted/40',
        )}
      >
        {value ? (
          <>
            <img src={value} alt="Member" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute right-1.5 top-1.5 rounded-full bg-background/85 p-1.5 backdrop-blur transition-colors hover:bg-background"
              aria-label="Remove photo"
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : isStreaming ? (
          <video
            ref={videoRef}
            playsInline
            muted
            // Mirrored, the way people expect to see themselves.
            className="size-full -scale-x-100 object-cover"
          />
        ) : (
          <User className="size-10 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {isStreaming ? (
          <>
            <Button type="button" size="sm" onClick={capture}>
              <Camera />
              Capture
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={stopCamera}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void startCamera()}
              loading={isStarting}
            >
              {value ? <RefreshCw /> : <Camera />}
              {value ? 'Retake' : 'Take photo'}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              Upload
            </Button>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Optional — helps staff recognise members at the desk
      </p>
    </div>
  );
}
