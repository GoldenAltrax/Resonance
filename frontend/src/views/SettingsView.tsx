import { useState, useRef, FormEvent, useMemo } from 'react';
import { LogOut, Shield, User as UserIcon, ChevronRight, Camera, X, Loader2, Eye, EyeOff, Check } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { api } from '@/services/api';
import { validatePassword, getPasswordStrength, isPasswordValid } from '@/utils/password';

const SettingsView = () => {
  const { user, updateProfile, uploadAvatar, isLoading } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [editUsername, setEditUsername] = useState(user?.username || '');
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false);
    setIsLoggingOut(true);
    const { logout } = useAuthStore.getState();
    setTimeout(() => logout(), 2000);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await uploadAvatar(file);
      toast.success('Avatar updated');
    } catch {
      // Error handled by store
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUsername.trim()) return;

    setIsSaving(true);
    try {
      await updateProfile({
        username: editUsername.trim(),
      });
      setShowEditModal(false);
      toast.success('Profile updated');
    } catch {
      // Error handled by store
    } finally {
      setIsSaving(false);
    }
  };

  const passwordValidation = useMemo(() => validatePassword(newPassword), [newPassword]);
  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const passwordIsValid = useMemo(() => isPasswordValid(newPassword), [newPassword]);

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;

    if (!passwordIsValid) {
      toast.error('Password does not meet all requirements');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setShowSecurityModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const openEditModal = () => {
    setEditUsername(user?.username || '');
    setShowEditModal(true);
  };

  const openSecurityModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowSecurityModal(true);
  };

  const sections = [
    { icon: UserIcon, label: 'Account', detail: 'Public profile, username', onClick: openEditModal },
    { icon: Shield, label: 'Security', detail: 'Password, authentication', onClick: openSecurityModal },
  ];

  // Resolve profile image URL with cache-busting for local images
  const profileImageUrl = user?.profileImage
    ? user.profileImage.startsWith('http')
      ? user.profileImage
      : `/uploads/${user.profileImage}?t=${Date.now()}`
    : `https://api.dicebear.com/7.x/initials/svg?seed=${user?.username || 'User'}`;

  if (isLoggingOut) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col items-center justify-center animate-in fade-in duration-700">
        <svg className="animate-spin h-10 w-10 text-zinc-500 mb-6" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <h2 className="text-xl font-light text-white tracking-widest uppercase">Logging out...</h2>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-12">
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-widest mb-1">Preferences</h2>
        <h1 className="text-4xl font-semibold text-white tracking-tight">Settings</h1>
      </header>

      <section className="bg-zinc-900/20 border border-zinc-800/50 rounded-3xl overflow-hidden mb-8">
        <div className="p-8 flex items-center gap-8">
          <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
            <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-zinc-800 p-1">
              <img src={profileImageUrl} alt="Profile" loading="lazy" decoding="async" className="w-full h-full object-cover rounded-full" />
            </div>
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {isLoading ? (
                <Loader2 className="text-white w-6 h-6 animate-spin" />
              ) : (
                <Camera className="text-white w-6 h-6" />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-white">{user?.username}</h3>
            <p className="text-zinc-500 mb-4">{user?.email || 'No email set'}</p>
            <button
              onClick={openEditModal}
              className="text-xs font-bold uppercase tracking-widest px-4 py-2 border border-zinc-800 rounded-lg hover:bg-white hover:text-black transition-all"
            >
              Edit Profile
            </button>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        {sections.map((section, i) => (
          <button
            key={i}
            onClick={section.onClick}
            className="w-full flex items-center justify-between p-6 bg-zinc-900/10 border border-zinc-800/30 rounded-2xl hover:bg-zinc-800/30 transition-all group"
          >
            <div className="flex items-center gap-5">
              <div className="w-12 h-12 bg-zinc-900 rounded-xl flex items-center justify-center text-zinc-500 group-hover:text-zinc-300 transition-colors">
                <section.icon className="w-6 h-6" />
              </div>
              <div className="text-left">
                <h4 className="font-medium text-white">{section.label}</h4>
                <p className="text-xs text-zinc-500">{section.detail}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 transition-all group-hover:translate-x-1" />
          </button>
        ))}
      </div>

      <div className="mt-16 pt-8 border-t border-zinc-900/50">
        <button
          onClick={handleLogoutClick}
          className="flex items-center gap-3 px-8 py-4 bg-zinc-900/50 hover:bg-red-500/10 border border-zinc-800 rounded-2xl text-red-500 font-medium transition-all w-full md:w-auto"
        >
          <LogOut className="w-5 h-5" />
          Logout from Resonance
        </button>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
          <div className="bg-[#111111] border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-2">Confirm Logout</h3>
            <p className="text-zinc-400 text-sm mb-6">Are you sure you want to logout from Resonance?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogoutConfirm}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-28 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111111] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl max-h-[70vh] overflow-y-auto">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Edit Profile</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                  Username
                </label>
                <input
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  placeholder="Your username"
                  className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                />
              </div>

              {user?.email && (
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                    Email
                  </label>
                  <div className="w-full bg-[#0d0d0d] border border-zinc-800/50 rounded-xl px-4 py-3 text-zinc-500">
                    {user.email}
                  </div>
                  <p className="text-[10px] text-zinc-600 px-1">Email cannot be changed</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-3 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-zinc-100 hover:bg-white text-black font-semibold px-4 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Security Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-28 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#111111] border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl max-h-[70vh] overflow-y-auto">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Change Password</h2>
              <button
                onClick={() => setShowSecurityModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePasswordChange} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    required
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 pr-12 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    required
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 pr-12 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {/* Password strength indicator */}
                {newPassword && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            passwordStrength === 'strong' ? 'bg-green-500' :
                            passwordStrength === 'good' ? 'bg-yellow-500' :
                            passwordStrength === 'fair' ? 'bg-orange-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${
                            passwordStrength === 'strong' ? 100 :
                            passwordStrength === 'good' ? 75 :
                            passwordStrength === 'fair' ? 50 : 25
                          }%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium capitalize ${
                        passwordStrength === 'strong' ? 'text-green-500' :
                        passwordStrength === 'good' ? 'text-yellow-500' :
                        passwordStrength === 'fair' ? 'text-orange-500' : 'text-red-500'
                      }`}>
                        {passwordStrength}
                      </span>
                    </div>

                    {/* Requirements checklist */}
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className={`flex items-center gap-1.5 ${passwordValidation.minLength ? 'text-green-500' : 'text-zinc-600'}`}>
                        {passwordValidation.minLength ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        8+ characters
                      </div>
                      <div className={`flex items-center gap-1.5 ${passwordValidation.hasUppercase ? 'text-green-500' : 'text-zinc-600'}`}>
                        {passwordValidation.hasUppercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Uppercase
                      </div>
                      <div className={`flex items-center gap-1.5 ${passwordValidation.hasLowercase ? 'text-green-500' : 'text-zinc-600'}`}>
                        {passwordValidation.hasLowercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Lowercase
                      </div>
                      <div className={`flex items-center gap-1.5 ${passwordValidation.hasNumber ? 'text-green-500' : 'text-zinc-600'}`}>
                        {passwordValidation.hasNumber ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Number
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold px-1">
                  Confirm New Password
                </label>
                <input
                  required
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-[#161616] border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowSecurityModal(false)}
                  className="flex-1 px-4 py-3 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="flex-1 bg-zinc-100 hover:bg-white text-black font-semibold px-4 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Changing...
                    </>
                  ) : (
                    'Change Password'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
