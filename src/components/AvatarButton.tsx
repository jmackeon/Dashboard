// src/components/AvatarButton.tsx
import { useRef, type ChangeEvent } from 'react';
import { uploadAvatar } from '../lib/uploadAvatar';
import { supabase } from '../lib/supabaseClient';

export default function AvatarButton({
  src,
  size = 40,
}: {
  src: string | null;
  size?: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSelect = () => fileRef.current?.click();

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadAvatar(file);
      // update user metadata
      await supabase.auth.updateUser({
        data: { avatar_url: url },
      });
      window.location.reload(); // simplest way to refresh avatar in state
    } catch (err) {
      alert('Upload failed :' + (err as Error).message);
    }
  };

  return (
    <>
      <img
        onClick={handleSelect}
        src={src ?? '/blank-avatar.png'}
        style={{ width: size, height: size }}
        className="rounded-full object-cover border cursor-pointer hover:opacity-80 transition"
        alt="avatar"
      />
      <input
        type="file"
        accept="image/*"
        hidden
        ref={fileRef}
        onChange={handleChange}
      />
    </>
  );
}
