import { t } from '../i18n'

interface LegendProps {
  showHeatmap?: boolean
  onToggleHeatmap?: () => void
}

export function Legend({ showHeatmap = false, onToggleHeatmap }: LegendProps) {
  return (
    <div className="legend" aria-label="Map legend">
      {onToggleHeatmap && (
        <label className="legend__item legend__item--toggle">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={onToggleHeatmap}
            aria-label={t('showHeatmap')}
          />
          <span>{t('showHeatmap')}</span>
        </label>
      )}
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--heat-high" /> {t('legendHigh')}
      </div>
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--heat-mid" /> {t('legendMedium')}
      </div>
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--heat-low" /> {t('legendLow')}
      </div>
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--active" /> {t('legendActive')}
      </div>
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--route" /> {t('legendRoute')}
      </div>
      <div className="legend__item">
        <span className="legend__swatch legend__swatch--shelter" /> {t('legendShelter')}
      </div>
    </div>
  )
}
