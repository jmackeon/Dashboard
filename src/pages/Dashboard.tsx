import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import AvatarButton from '../components/AvatarButton';

interface LinkItem {
  name: string;
  url: string;
  icon?: string;
  external?: boolean;
}

export default function Dashboard() {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [fullName, setFullName] = useState('Admin');
  const [email, setEmail] = useState('admin@elitelac.com');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setFullName(data.user.user_metadata?.full_name || 'Admin');
        setAvatar(data.user.user_metadata?.avatar_url || null);
        setEmail(data.user.email || email);
      }
    })();
  }, []);

  const logout = () => supabase.auth.signOut();

  const appTiles: LinkItem[] = [
    { name: 'Attendance', url: 'https://attendance.vercel.app', icon: '/Attendance.png' },
    { name: 'LacDrop', url: 'https://www.lacdrop.com', icon: '/LacDrop.png' },
    { name: 'Procurement', url: 'https://procurement.yoursite.com', icon: '/Procurement System.png' },
    { name: 'Canteen', url: '#', icon: '/Canteen.png' },
    { name: 'Toddle', url: 'https://web.toddleapp.com/?type=loginHome', external: true, icon: '/toddle.png' },
    { name: 'Knox Manage', url: 'https://eu08.manage.samsungknox.com/emm/admin/secured/emm_main.do#dashboardHome@1751291527',external: true, icon: '/knox.png' },
    { name: 'Classter', url: 'https://identity.classter.com/ids/login?signin=82071af4c84e15dab7b70d44e85fe58c',external: true ,icon: '/Classter.png' },
    { name: 'Google Chat', url: 'https://chat.google.com', external: true, icon: '/chat.png' },
    { name: 'Gmail', url: 'https://mail.google.com', external: true, icon: '/Gmail.png' },
    { name: 'Outlook', url: 'https://outlook.office.com', external: true, icon: '/outlook.png' },
  ];

  return (
          <div className="min-h-screen bg-cover bg-center" style={{ backgroundImage: "url('/Background.png')" }}>
        <div className="min-h-screen flex flex-col bg-black/10 backdrop-blur-sm">
          {/* Top bar */}
          <div className="flex items-center justify-between p-4 md:p-6">
            {/* avatar + name */}
            <div className="flex items-center gap-3">
              <AvatarButton src={avatar} size={40} />

              <div className="hidden sm:block leading-tight text-white drop-shadow">
                <p className="font-medium text-sm">{fullName}</p>
                <p className="text-xs opacity-80">{email}</p>
              </div>
            </div>

          <div className="flex items-center gap-4">
            <button title="Settings" className="h-10 w-10 rounded-full backdrop-blur bg-gray-800/70 hover:bg-gray-800 flex items-center justify-center shadow">
              <img src="/Windows_Settings_icon.svg.png" alt="settings" className="h-6 w-6" />
            </button>
            <button onClick={logout} title="Logout" className="h-10 w-10 rounded-full backdrop-blur bg-red-600 hover:bg-red-700 flex items-center justify-center shadow">
              <img src="/12635060.png" alt="logout" className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Header */}
        <header className="flex flex-col items-center text-center gap-2 mb-8">
          <img src="/logo-school.png" alt="School logo" className="h-20 w-auto" />
          <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-xl">London Academy Portal</h1>
        </header>

        {/* Tiles */}
        <main className="flex-1 flex justify-center px-4 pb-12 overflow-y-auto">
          <div className="max-w-4xl w-full backdrop-blur-lg bg-white/25 rounded-xl p-8 md:p-12">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              {appTiles.map(tile => (
                <a
                  key={tile.name}
                  href={tile.url}
                  target={tile.external ? '_blank' : undefined}
                  rel={tile.external ? 'noopener noreferrer' : undefined}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/30 hover:bg-white/40 backdrop-blur-md p-6 text-center shadow-lg transition"
                >
                  {tile.icon ? (
                    <img src={tile.icon} alt={tile.name} className="h-10 w-10 object-contain" />
                  ) : (
                    <span className="h-10 w-10 bg-blue-600/20 text-blue-800 rounded flex items-center justify-center font-semibold text-lg">
                      {tile.name.charAt(0)}
                    </span>
                  )}
                  <span className="text-sm font-medium text-gray-900 drop-shadow text-center max-w-[9ch] truncate">
                    {tile.name}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
