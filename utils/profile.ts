import { supabase } from './supabase';

export type UserProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  updated_at?: string;
};

export async function loadProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, avatar_url, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data as UserProfile | null;
}

export async function upsertProfile(
  userId: string,
  patch: Partial<Pick<UserProfile, 'display_name' | 'avatar_url'>>
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        display_name: patch.display_name ?? '',
        avatar_url: patch.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .maybeSingle();
  if (error) return null;
  return data as UserProfile | null;
}
