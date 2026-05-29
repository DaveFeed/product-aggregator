/**
 * PriceChart — Recharts line chart of price history over selectable date ranges.
 * Task 34.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
]

export default function PriceChart({ productId }) {
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery({
    queryKey: ['priceHistory', productId, days],
    queryFn: () => api.get(`/api/analytics/price-history?product_id=${productId}&days=${days}`).then((r) => r.data),
    enabled: !!productId,
  })

  if (!productId) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Price History</h3>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-2 py-1 text-xs rounded ${
                days === r.days ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-center py-8">Loading...</p>}

      {data?.points?.length > 0 ? (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={(d) => new Date(d).toLocaleDateString()} fontSize={10} />
            <YAxis fontSize={10} />
            <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString()} />
            <Line type="monotone" dataKey="avg" stroke="#3b82f6" name="Avg" dot={false} />
            <Line type="monotone" dataKey="min" stroke="#10b981" name="Min" dot={false} />
            <Line type="monotone" dataKey="max" stroke="#ef4444" name="Max" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        !isLoading && <p className="text-gray-400 text-center py-8">No price data available</p>
      )}
    </div>
  )
}
