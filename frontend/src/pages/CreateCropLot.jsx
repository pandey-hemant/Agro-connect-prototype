/**
 * CreateCropLot.jsx — list a new crop lot.
 *
 * Mounted at /seller/crop-lots/new (and the legacy /farmer/create).
 * The business logic — form state, validation, dispatch, redirect
 * to the new lot's detail page — is preserved verbatim. The chrome
 * is the redesigned application shell: a PageHeader, a clean
 * form laid out on design-system tokens, and a single
 * primary action.
 */
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { createCropLot, clearCreateState } from '../redux/slices/cropLotSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const FIELD =
  'mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
const FIELD_ERROR = 'border-rust-300 focus:border-rust-500 focus:ring-rust-500'

function CreateCropLot() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { createStatus, createError, createdLot } = useSelector(
    (state) => state.cropLots
  )
  usePageMeta({
    title: 'List a crop lot',
    description: 'Tell buyers about your crop — quantity, location, harvest date, and the price you want.',
  })

  const [formData, setFormData] = useState({
    crop_name: '',
    crop_variety: '',
    quantity: '',
    quantity_unit: 'quintal',
    harvest_date: '',
    location: '',
    preferred_selling_radius_km: '',
    farmer_quality_notes: '',
    minimum_acceptable_price: '',
    price_currency: 'INR',
  })

  const [errors, setErrors] = useState({})

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }))
    }
  }

  const validateForm = () => {
    const newErrors = {}

    if (!formData.crop_name.trim()) newErrors.crop_name = 'Crop name is required'
    if (!formData.crop_variety.trim()) newErrors.crop_variety = 'Crop variety is required'

    const qty = parseFloat(formData.quantity)
    if (!formData.quantity || isNaN(qty) || qty <= 0) {
      newErrors.quantity = 'Quantity must be a positive number'
    }
    if (!formData.harvest_date) {
      newErrors.harvest_date = 'Harvest date is required'
    }
    if (!formData.location.trim()) {
      newErrors.location = 'Location is required'
    }
    if (formData.preferred_selling_radius_km) {
      const radius = parseFloat(formData.preferred_selling_radius_km)
      if (isNaN(radius) || radius < 0) {
        newErrors.preferred_selling_radius_km = 'Radius must be 0 or greater'
      }
    }
    if (formData.minimum_acceptable_price) {
      const price = parseFloat(formData.minimum_acceptable_price)
      if (isNaN(price) || price < 0) {
        newErrors.minimum_acceptable_price = 'Price must be 0 or greater'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return

    const payload = {
      crop_name: formData.crop_name.trim(),
      crop_variety: formData.crop_variety.trim(),
      quantity: parseFloat(formData.quantity),
      quantity_unit: formData.quantity_unit,
      harvest_date: formData.harvest_date,
      location: formData.location.trim(),
      price_currency: formData.price_currency,
    }
    if (formData.preferred_selling_radius_km) {
      payload.preferred_selling_radius_km = parseFloat(
        formData.preferred_selling_radius_km
      )
    }
    if (formData.farmer_quality_notes.trim()) {
      payload.farmer_quality_notes = formData.farmer_quality_notes.trim()
    }
    if (formData.minimum_acceptable_price) {
      payload.minimum_acceptable_price = parseFloat(
        formData.minimum_acceptable_price
      )
    }

    try {
      const result = await dispatch(createCropLot(payload))
      if (createCropLot.fulfilled.match(result)) {
        setTimeout(() => {
          dispatch(clearCreateState())
          navigate(`/seller/crop-lots/${result.payload.public_id}`)
        }, 800)
      } else {
        console.error('createCropLot rejected:', result)
      }
    } catch (err) {
      console.error('createCropLot dispatch threw:', err)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="List a new crop lot"
        description="Tell buyers what you have, how much, and where it is. The more accurate, the better the offers you receive."
        back={{ to: '/seller/crop-lots', label: 'My Crops' }}
      />

      <form
        onSubmit={handleSubmit}
        className="ac-card mx-auto max-w-3xl p-6 sm:p-8"
      >
        {/* Live crop preview — gives the form a visual hook and
            reassures the farmer they typed the crop they meant. */}
        {formData.crop_name.trim() && (
          <div className="mb-6 flex items-center gap-4 rounded-lg border border-earth-200 bg-earth-50 p-3">
            <CropImage
              crop={formData.crop_name}
              label={formData.crop_name}
              className="h-14 w-14 flex-shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">
                {formData.crop_name}
                {formData.crop_variety
                  ? ` · ${formData.crop_variety}`
                  : ''}
              </p>
              <p className="truncate text-xs text-ink-500">
                {formData.quantity
                  ? `${formData.quantity} ${formData.quantity_unit}`
                  : 'Quantity not set yet'}
                {formData.location ? ` · ${formData.location}` : ''}
              </p>
            </div>
          </div>
        )}

        {createStatus === 'succeeded' && createdLot && (
          <div className="mb-6 rounded-card border border-success-200 bg-success-50 p-4">
            <p className="text-sm font-medium text-success-700">
              Crop lot created. Opening it now…
            </p>
          </div>
        )}
        {createStatus === 'failed' && createError && (
          <div className="mb-6 rounded-lg border border-rust-200 bg-rust-50 p-4">
            <p className="text-sm font-medium text-rust-800">
              Could not create the crop lot
            </p>
            <p className="mt-1 text-sm text-rust-700">{createError}</p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="crop_name"
              className="block text-xs font-medium text-ink-700"
            >
              Crop name <span className="text-rust-500">*</span>
            </label>
            <input
              type="text"
              id="crop_name"
              name="crop_name"
              value={formData.crop_name}
              onChange={handleChange}
              placeholder="e.g., Tomato, Wheat, Rice"
              className={`${FIELD} ${errors.crop_name ? FIELD_ERROR : ''}`}
            />
            {errors.crop_name && (
              <p className="mt-1 text-xs text-rust-600">{errors.crop_name}</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="crop_variety"
              className="block text-xs font-medium text-ink-700"
            >
              Crop variety <span className="text-rust-500">*</span>
            </label>
            <input
              type="text"
              id="crop_variety"
              name="crop_variety"
              value={formData.crop_variety}
              onChange={handleChange}
              placeholder="e.g., Roma, Basmati, IR64"
              className={`${FIELD} ${errors.crop_variety ? FIELD_ERROR : ''}`}
            />
            {errors.crop_variety && (
              <p className="mt-1 text-xs text-rust-600">
                {errors.crop_variety}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="quantity"
              className="block text-xs font-medium text-ink-700"
            >
              Quantity <span className="text-rust-500">*</span>
            </label>
            <input
              type="number"
              id="quantity"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              step="0.01"
              min="0.01"
              placeholder="100"
              className={`${FIELD} ${errors.quantity ? FIELD_ERROR : ''}`}
            />
            {errors.quantity && (
              <p className="mt-1 text-xs text-rust-600">{errors.quantity}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="quantity_unit"
              className="block text-xs font-medium text-ink-700"
            >
              Unit <span className="text-rust-500">*</span>
            </label>
            <select
              id="quantity_unit"
              name="quantity_unit"
              value={formData.quantity_unit}
              onChange={handleChange}
              className={FIELD}
            >
              <option value="kg">Kilogram (kg)</option>
              <option value="quintal">Quintal</option>
              <option value="ton">Ton</option>
              <option value="bag">Bag</option>
              <option value="crate">Crate</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="harvest_date"
              className="block text-xs font-medium text-ink-700"
            >
              Harvest date <span className="text-rust-500">*</span>
            </label>
            <input
              type="date"
              id="harvest_date"
              name="harvest_date"
              value={formData.harvest_date}
              onChange={handleChange}
              className={`${FIELD} ${errors.harvest_date ? FIELD_ERROR : ''}`}
            />
            {errors.harvest_date ? (
              <p className="mt-1 text-xs text-rust-600">
                {errors.harvest_date}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-500">
                Expected harvest date or already harvested date.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="location"
              className="block text-xs font-medium text-ink-700"
            >
              Location <span className="text-rust-500">*</span>
            </label>
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="Village, District, State"
              className={`${FIELD} ${errors.location ? FIELD_ERROR : ''}`}
            />
            {errors.location && (
              <p className="mt-1 text-xs text-rust-600">{errors.location}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="preferred_selling_radius_km"
              className="block text-xs font-medium text-ink-700"
            >
              Preferred selling radius (km)
            </label>
            <input
              type="number"
              id="preferred_selling_radius_km"
              name="preferred_selling_radius_km"
              value={formData.preferred_selling_radius_km}
              onChange={handleChange}
              step="1"
              min="0"
              placeholder="50"
              className={`${FIELD} ${
                errors.preferred_selling_radius_km ? FIELD_ERROR : ''
              }`}
            />
            {errors.preferred_selling_radius_km ? (
              <p className="mt-1 text-xs text-rust-600">
                {errors.preferred_selling_radius_km}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-500">
                How far you are willing to ship or sell.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="minimum_acceptable_price"
              className="block text-xs font-medium text-ink-700"
            >
              Minimum acceptable price (per unit)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                id="minimum_acceptable_price"
                name="minimum_acceptable_price"
                value={formData.minimum_acceptable_price}
                onChange={handleChange}
                step="0.01"
                min="0"
                placeholder="1500"
                className={`${FIELD} ${
                  errors.minimum_acceptable_price ? FIELD_ERROR : ''
                }`}
              />
              <select
                id="price_currency"
                name="price_currency"
                value={formData.price_currency}
                onChange={handleChange}
                className={FIELD + ' w-28'}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </div>
            {errors.minimum_acceptable_price && (
              <p className="mt-1 text-xs text-rust-600">
                {errors.minimum_acceptable_price}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="farmer_quality_notes"
              className="block text-xs font-medium text-ink-700"
            >
              Quality notes (your observation)
            </label>
            <textarea
              id="farmer_quality_notes"
              name="farmer_quality_notes"
              value={formData.farmer_quality_notes}
              onChange={handleChange}
              rows={3}
              placeholder="e.g., Grade A appearance, no visible damage, stored in cool conditions"
              className={FIELD}
            />
            <p className="mt-1 text-xs text-ink-500">
              This is your own observation — not an official grade.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-6">
          <button
            type="submit"
            disabled={createStatus === 'loading'}
            className="ac-btn-primary"
          >
            {createStatus === 'loading' ? 'Creating…' : 'Create crop lot'}
          </button>
          <Link to="/seller/crop-lots" className="ac-btn-ghost">
            Cancel
          </Link>
          <p className="ml-auto text-xs text-ink-500">
            You can edit these details any time before a buyer accepts an
            offer.
          </p>
        </div>
      </form>
    </>
  )
}

export default CreateCropLot
