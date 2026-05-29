/**
 * DealScoreMeter — radial gauge showing deal score 0-1.
 * Task 35 sub-component.
 */
export default function DealScoreMeter({ score }) {
  const displayScore = score != null ? score : null
  const pct = displayScore != null ? Math.round(displayScore * 100) : 0
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444'

  // SVG arc for the gauge.
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col items-center">
      <h3 className="text-lg font-medium mb-2">Deal Score</h3>
      {displayScore != null ? (
        <div className="relative w-28 h-28">
          <svg className="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={radius}
              fill="none" stroke={color} strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold" style={{ color }}>{pct}%</span>
          </div>
        </div>
      ) : (
        <p className="text-gray-400 py-8">N/A</p>
      )}
    </div>
  )
}
