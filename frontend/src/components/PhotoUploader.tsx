import React, { useRef, useState } from 'react';
import api from '@/api/client';
import { Button } from '@/components/ui';
import { Camera } from 'lucide-react';

/** 现场拍照上传（登录态）：多图，返回 filePath 数组。移动端调起相机。 */
export function PhotoUploader({
  photos,
  onChange,
  max = 9,
  label = '拍照 / 选图',
}: {
  photos: string[];
  onChange: (next: string[]) => void;
  max?: number;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setErr('');
    try {
      const up: string[] = [];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        const { data } = await api.post('/files/upload', fd);
        up.push(data.url);
      }
      onChange([...photos, ...up].slice(0, max));
    } catch (e: any) {
      setErr(e.response?.data?.message || '图片上传失败');
    } finally {
      setUploading(false);
      // 允许再次选择同一文件（清空 input 值）
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {photos.length < max && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Camera size={16} className="mr-1" /> {label}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
          </>
        )}
        {uploading && <span className="text-xs text-muted-foreground">上传中…</span>}
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p} className="h-16 w-16 rounded-lg border border-border object-cover" alt="" />
              <button
                type="button"
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PhotoUploader;
