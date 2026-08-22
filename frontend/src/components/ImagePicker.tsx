import { useId, useState, type ChangeEvent, type DragEvent } from 'react';
import { Icon } from './Icon';

interface SelectedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

interface ImagePickerProps {
  disabled?: boolean;
  isValidating?: boolean;
  selected?: SelectedImage;
  onSelect: (file: File) => void;
  onRemove: () => void;
}

const inputAccept = 'image/jpeg,image/png,image/webp';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImagePicker({ disabled, isValidating, selected, onSelect, onRemove }: ImagePickerProps) {
  const pickerId = useId();
  const cameraId = useId();
  const [isDragging, setIsDragging] = useState(false);

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onSelect(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onSelect(file);
  };

  if (selected) {
    return (
      <div className="image-preview-card">
        <div className="image-preview-card__visual">
          <img src={selected.previewUrl} alt="Selected crop leaf preview" />
          <span className="image-preview-card__ready"><Icon name="check" size={15} /> Ready</span>
        </div>
        <div className="image-preview-card__details">
          <div>
            <strong>{selected.file.name}</strong>
            <span>{formatBytes(selected.file.size)} · {selected.width} × {selected.height}px</span>
          </div>
          <div className="image-preview-card__actions">
            <label className="button button--secondary button--small" htmlFor={pickerId}>
              <Icon name="refresh" size={17} /> Change
            </label>
            <input
              className="visually-hidden"
              id={pickerId}
              type="file"
              accept={inputAccept}
              disabled={disabled}
              onChange={handleInput}
            />
            <button className="button button--quiet button--small" type="button" disabled={disabled} onClick={onRemove}>
              <Icon name="close" size={17} /> Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        className={`upload-dropzone${isDragging ? ' upload-dropzone--dragging' : ''}${disabled ? ' upload-dropzone--disabled' : ''}`}
        htmlFor={pickerId}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          className="visually-hidden"
          id={pickerId}
          type="file"
          accept={inputAccept}
          disabled={disabled}
          onChange={handleInput}
        />
        <span className="upload-dropzone__icon"><Icon name="upload" size={27} /></span>
        <strong>{isValidating ? 'Checking your image…' : 'Drop a crop image here'}</strong>
        <span>or tap to choose from your device</span>
        <span className="button button--secondary button--small" aria-hidden="true">Choose image</span>
      </label>

      <div className="camera-option">
        <span>Using a phone?</span>
        <label className="button button--quiet button--small" htmlFor={cameraId}>
          <Icon name="camera" size={18} /> Take a photo
        </label>
        <input
          className="visually-hidden"
          id={cameraId}
          type="file"
          accept={inputAccept}
          capture="environment"
          disabled={disabled}
          onChange={handleInput}
        />
      </div>
    </div>
  );
}
