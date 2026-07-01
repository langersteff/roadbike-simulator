import type { Chunk, ChunkOverrides, RiderProfile } from '../../lib/ride/types';
import { ChunkRow } from './ChunkRow';
import { CHUNKS_EMPTY } from '../../lib/uiCopy';

interface ChunkListProps {
  chunks: Chunk[];
  profile: RiderProfile;
  autoAerobar: boolean;
  curvyActive: boolean;
  highlightedIndex: number | null;
  onHoverChunk: (index: number | null) => void;
  onOverrideChange: (chunkIndex: number, next: ChunkOverrides) => void;
  onSplit: (chunkIndex: number) => void;
  onMergeWithNext: (chunkIndex: number) => void;
  onJumpToChunk: (chunkIndex: number) => void;
}

export function ChunkList({
  chunks,
  profile,
  autoAerobar,
  curvyActive,
  highlightedIndex,
  onHoverChunk,
  onOverrideChange,
  onSplit,
  onMergeWithNext,
  onJumpToChunk,
}: ChunkListProps) {
  if (chunks.length === 0) {
    return <div className="chunk-list chunk-list--empty">{CHUNKS_EMPTY}</div>;
  }
  return (
    <div className="chunk-list">
      <div className="chunk-list__header">
        <span>#</span>
        <span>Range</span>
        <span>Grade</span>
        <span>Wind</span>
        <span>Temp</span>
        <span>Position</span>
        <span>Power</span>
        <span>Velocity</span>
        <span>Time</span>
        <span aria-hidden="true" />
      </div>
      {chunks.map((chunk, listIndex) => (
        <ChunkRow
          key={chunk.index}
          chunk={chunk}
          profile={profile}
          autoAerobar={autoAerobar}
          curvyActive={curvyActive}
          highlighted={highlightedIndex === chunk.index}
          onHover={(hovering) => onHoverChunk(hovering ? chunk.index : null)}
          onChange={(next) => onOverrideChange(chunk.index, next)}
          onSplit={() => onSplit(chunk.index)}
          onMergeWithNext={() => onMergeWithNext(chunk.index)}
          onJumpToMap={() => onJumpToChunk(chunk.index)}
          canMerge={listIndex < chunks.length - 1}
          canSplit={chunk.endIndex - chunk.startIndex >= 2}
        />
      ))}
    </div>
  );
}
