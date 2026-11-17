import type { Metadata } from 'next';
import { ProfileSettings } from '@/components/settings/profile-settings';

export const metadata: Metadata = { title: 'Account settings - ViralClip AI' };

export default function ProfileSettingsPage() {
  return <ProfileSettings />;
}
