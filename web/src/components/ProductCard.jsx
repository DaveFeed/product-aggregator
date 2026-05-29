/**
 * ProductCard — displays a product with title, price, provider, and action buttons.
 * Task 33.
 */
export default function ProductCard({ product, onAddToCart, onViewDetails, onViewPriceHistory }) {
  const isDeal = product.deal_score >= 0.7

  return (
    <div className="flex items-start gap-4 bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="w-16 h-16 flex-shrink-0 rounded bg-gray-100 overflow-hidden">
        {product.image_url ? (
          <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No img</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-900 truncate">{product.title}</h3>
          {isDeal && (
            <span className="flex-shrink-0 bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full font-medium">
              Deal
            </span>
          )}
        </div>
        <p className="text-lg font-semibold text-blue-600 mt-1">{product.price} AMD</p>
        <p className="text-xs text-gray-500">{product.provider || 'Unknown provider'}</p>
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        {onAddToCart && (
          <button
            onClick={() => onAddToCart(product)}
            className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
          >
            Add to cart
          </button>
        )}
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(product)}
            className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded hover:bg-gray-200"
          >
            Details
          </button>
        )}
        {onViewPriceHistory && (
          <button
            onClick={() => onViewPriceHistory(product)}
            className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded hover:bg-gray-200"
          >
            Price history
          </button>
        )}
      </div>
    </div>
  )
}
