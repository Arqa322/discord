
export const Soundboard = () => (
  <div className="grid grid-cols-2 gap-2 p-4 bg-gray-800 rounded">
    <button className="bg-gray-700 p-2 rounded">🔊 Airhorn</button>
    <button className="bg-gray-700 p-2 rounded">🎵 Crickets</button>
  </div>
);

export const VolumeSlider = ({ userId, type, value, onChange }: any) => (
  <div className="p-2 bg-gray-900 border border-gray-700 rounded absolute z-50">
    <label className="text-xs">{type === 'mic' ? 'Микрофон' : 'Динамик'}</label>
    <input 
      type="range" min="0" max="1" step="0.1" value={value} 
      onChange={(e) => onChange(userId, type, parseFloat(e.target.value))}
      className="w-full"
    />
  </div>
);
