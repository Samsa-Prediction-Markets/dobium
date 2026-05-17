import React from 'react';

export default function NotificationsPanel({ isOpen, onClose }) {
  return (
    <>
      {/* Invisible overlay to close panel when clicking outside */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={onClose}
        />
      )}

      {/* Sliding Drawer positioned right after the collapsed sidebar (80px) */}
      <div
        className={`fixed top-0 left-[80px] h-full w-[350px] sm:w-[400px] bg-slate-950 border-r border-slate-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex flex-col h-full">
          <div className="px-6 py-5 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">Notifications</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="space-y-4">
              <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">New</div>

              {/* Example Notification Item 1 */}
              <div className="flex items-start gap-3 p-3 hover:bg-slate-900 rounded-lg cursor-pointer transition-colors">
                <div className="w-10 h-10 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center flex-shrink-0">
                  ✓
                </div>
                <div>
                  <p className="text-sm text-slate-200">
                    Market <span className="font-bold text-white">"Will OpenAI release GPT-5 by Q2 2025?"</span> resolved to Yes.
                  </p>
                  <span className="text-xs text-slate-500 mt-1 block">2h ago</span>
                </div>
              </div>

              {/* Example Notification Item 2 */}
              <div className="flex items-start gap-3 p-3 hover:bg-slate-900 rounded-lg cursor-pointer transition-colors">
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center flex-shrink-0">
                  $
                </div>
                <div>
                  <p className="text-sm text-slate-200">
                    Your prediction won! You received a payout of <span className="font-bold text-green-400">$150.00</span>.
                  </p>
                  <span className="text-xs text-slate-500 mt-1 block">5h ago</span>
                </div>
              </div>

              <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-6 mb-2">Earlier</div>
              {/* More notifications map out here */}

            </div>
          </div>
        </div>
      </div>
    </>
  );
}