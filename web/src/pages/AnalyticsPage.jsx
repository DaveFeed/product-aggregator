import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PriceChart from '../components/PriceChart'
import DealScoreMeter from '../components/DealScoreMeter'
import api from '../api'

export default function AnalyticsPage() {
  const { productId: urlProductId } = useParams()
  const [productId, setProductId] = useState(urlProductId || '')

  const { data: dealScore } = useQuery({
    queryKey: ['dealScore', productId],
    queryFn: () => api.get(`/api/analytics/deal-score?product_id=${productId}`).then((r) => r.data),
    enabled: !!productId && !isNaN(productId),
  })

  const { data: comparison } = useQuery({
    queryKey: ['comparison', productId],
    queryFn: async () => {
      const ph = await api.get(`/api/analytics/price-history?product_id=${productId}&days=1`)
      if (!ph.data?.current_price) return null
      // Use price history to get product info, then compare across providers.
      return api.get(`/api/analytics/provider-comparison?product_title=product`).then((r) => r.data)
    },
    enabled: !!productId && !isNaN(productId),
  })

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-semibold mb-4">Price Analytics</h2>

      <div className="flex gap-2 mb-6">
        <input
          type="number"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          placeholder="Enter Product ID"
          className="border border-gray-300 rounded-lg px-4 py-2 w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {productId && !isNaN(productId) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PriceChart productId={productId} />
          <DealScoreMeter score={dealScore?.deal_score} />

          {comparison?.items?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 md:col-span-2">
              <h3 className="text-lg font-medium mb-3">Provider Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3">Product</th>
                      <th className="text-left py-2 px-3">Provider</th>
                      <th className="text-right py-2 px-3">Price (AMD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.items.slice(0, 10).map((item, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 px-3 truncate max-w-[200px]">{item.title}</td>
                        <td className="py-2 px-3">{item.provider}</td>
                        <td className="py-2 px-3 text-right font-medium">{item.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {(!productId || isNaN(productId)) && (
        <div className="text-center text-gray-400 mt-10">
          <p>Enter a product ID to view price analytics.</p>
        </div>
      )}
    </div>
  )
}
