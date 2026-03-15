import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { JackpotResult } from '../stores/posStore';

interface JackpotOverlayProps {
  result: JackpotResult;
  onComplete: () => void;
}

type Phase = 'roulette' | 'result' | 'done';

/**
 * Full-screen casino overlay for client display.
 *
 * Flow:
 * 1. "roulette" phase: plays the roulette spinning video (~3s)
 * 2. "result" phase: plays either win or thanks video
 * 3. "done": fires onComplete callback
 *
 * Falls back to CSS animation + text if videos are unavailable.
 */
export function JackpotOverlay({ result, onComplete }: JackpotOverlayProps) {
  const [phase, setPhase] = useState<Phase>('roulette');
  const rouletteRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const isWin = result.type === 'mega_jackpot' || result.type === 'small_win';

  // Phase transition: roulette → result → done
  const goToResult = useCallback(() => setPhase('result'), []);
  const goToDone = useCallback(() => {
    setPhase('done');
    onComplete();
  }, [onComplete]);

  // Roulette phase
  useEffect(() => {
    if (phase !== 'roulette') return;

    const video = rouletteRef.current;
    if (video && result.rouletteVideoUrl) {
      video.play().catch(() => {});
    } else {
      // No video: fallback animation for 3s
      const timer = setTimeout(goToResult, 3000);
      return () => clearTimeout(timer);
    }
  }, [phase, result.rouletteVideoUrl, goToResult]);

  // Result phase
  useEffect(() => {
    if (phase !== 'result') return;

    const videoUrl = isWin ? result.winVideoUrl : result.thanksVideoUrl;
    const audioUrl = isWin ? result.winAudioUrl : result.thanksAudioUrl;
    const video = resultRef.current;
    const audio = audioRef.current;

    if (audio && audioUrl) {
      audio.src = audioUrl;
      audio.play().catch(() => {});
    }

    if (video && videoUrl) {
      video.src = videoUrl;
      video.play().catch(() => {});
    } else {
      // No video: show text fallback for 4s
      const timer = setTimeout(goToDone, 4000);
      return () => clearTimeout(timer);
    }
  }, [phase, isWin, result, goToDone]);

  // Safety timeout: never block display for more than 15s total
  useEffect(() => {
    const timer = setTimeout(onComplete, 15000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden">
      {/* Roulette phase */}
      {phase === 'roulette' && (
        <>
          {result.rouletteVideoUrl ? (
            <video
              ref={rouletteRef}
              src={result.rouletteVideoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              onEnded={goToResult}
              onError={goToResult}
            />
          ) : (
            <RouletteFallback />
          )}
        </>
      )}

      {/* Result phase */}
      {phase === 'result' && (
        <>
          {(isWin ? result.winVideoUrl : result.thanksVideoUrl) ? (
            <video
              ref={resultRef}
              className="w-full h-full object-cover"
              playsInline
              onEnded={goToDone}
              onError={goToDone}
            />
          ) : (
            <ResultFallback type={result.type} onDone={goToDone} />
          )}
          <audio ref={audioRef} />
        </>
      )}
    </div>
  );
}

/** CSS-only roulette animation fallback */
function RouletteFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 animate-pulse">
      <div className="text-8xl animate-spin" style={{ animationDuration: '0.5s' }}>
        &#127920;
      </div>
      <p className="text-white text-3xl font-bold tracking-widest uppercase animate-pulse">
        Tirage en cours...
      </p>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/** Text fallback for result phase */
function ResultFallback({
  type,
  onDone,
}: {
  type: JackpotResult['type'];
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (type === 'mega_jackpot') {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="text-9xl animate-bounce">&#127881;</div>
        <h1 className="text-white text-6xl font-black uppercase tracking-wider">
          MEGA JACKPOT !
        </h1>
        <p className="text-yellow-400 text-2xl">
          Felicitations ! Vous avez gagne le gros lot !
        </p>
      </div>
    );
  }

  if (type === 'small_win') {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="text-9xl animate-bounce">&#127775;</div>
        <h1 className="text-white text-5xl font-bold uppercase">
          Bravo !
        </h1>
        <p className="text-green-400 text-2xl">
          Vous avez gagne un lot !
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-8xl">&#128522;</div>
      <h1 className="text-white text-4xl font-bold">Merci !</h1>
      <p className="text-white/60 text-xl">
        Merci pour votre achat. A bientot !
      </p>
    </div>
  );
}
