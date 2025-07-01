// src/lib/uploadAvatar.ts
import { supabase } from './supabaseClient';

export async function uploadAvatar(file: File) {
  /* 1. get current user */
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) throw userErr ?? new Error('No user');

  const fileExt = file.name.split('.').pop();
  const filePath = `${user.id}.${fileExt}`;

  /* 2. upload / overwrite */
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true });
  if (upErr) throw upErr;

  /* 3. create signed URL */
  const { data, error: urlErr } = await supabase.storage
    .from('avatars')
    .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days
  if (urlErr) throw urlErr;
  if (!data) throw new Error('Failed to create a signed URL');

  return data.signedUrl; // TypeScript now knows data is non-null
}

