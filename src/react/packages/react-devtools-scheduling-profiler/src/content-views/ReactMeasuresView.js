/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import {
  durationToWidth,
  positioningScaleFactor,
  positionToTimestamp,
  timestampToPosition,
} from './utils/positioning';
import {
  View,
  Surface,
  rectContainsPoint,
  rectIntersectsRect,
  intersectionOfRects,
} from '../view-base';

import {COLORS, BORDER_SIZE, REACT_MEASURE_HEIGHT} from './constants';
import {REACT_TOTAL_NUM_LANES} from '../constants';

const REACT_LANE_HEIGHT = REACT_MEASURE_HEIGHT + BORDER_SIZE;

function getMeasuresForLane(allMeasures, lane) {
  return allMeasures.filter((measure) => measure.lanes.includes(lane));
}

export class ReactMeasuresView extends View {
  _profilerData;
  _intrinsicSize;

  _lanesToRender;
  _laneToMeasures;

  _hoveredMeasure = null;
  onHover = null;

  constructor(surface, frame, profilerData) {
    super(surface, frame);
    this._profilerData = profilerData;
    this._performPreflightComputations();
  }

  _performPreflightComputations() {
    this._lanesToRender = [];
    this._laneToMeasures = new Map();

    for (let lane = 0; lane < REACT_TOTAL_NUM_LANES; lane++) {
      const measuresForLane = getMeasuresForLane(
        this._profilerData.measures,
        lane,
      );
      // Only show lanes with measures
      if (measuresForLane.length) {
        this._lanesToRender.push(lane);
        this._laneToMeasures.set(lane, measuresForLane);
      }
    }

    this._intrinsicSize = {
      width: this._profilerData.duration,
      height: this._lanesToRender.length * REACT_LANE_HEIGHT,
    };
  }

  desiredSize() {
    return this._intrinsicSize;
  }

  setHoveredMeasure(hoveredMeasure) {
    if (this._hoveredMeasure === hoveredMeasure) {
      return;
    }
    this._hoveredMeasure = hoveredMeasure;
    this.setNeedsDisplay();
  }

  /**
   * Draw a single `ReactMeasure` as a bar in the canvas.
   */
  _drawSingleReactMeasure(
    context,
    rect,
    measure,
    baseY,
    scaleFactor,
    showGroupHighlight,
    showHoverHighlight,
  ) {
    const {frame} = this;
    const {timestamp, type, duration} = measure;

    let fillStyle = null;
    let hoveredFillStyle = null;
    let groupSelectedFillStyle = null;

    // We could change the max to 0 and just skip over rendering anything that small,
    // but this has the effect of making the chart look very empty when zoomed out.
    // So long as perf is okay- it might be best to err on the side of showing things.
    const width = durationToWidth(duration, scaleFactor);
    if (width <= 0) {
      return; // Too small to render at this zoom level
    }

    const x = timestampToPosition(timestamp, scaleFactor, frame);
    const measureRect = {
      origin: {x, y: baseY},
      size: {width, height: REACT_MEASURE_HEIGHT},
    };
    if (!rectIntersectsRect(measureRect, rect)) {
      return; // Not in view
    }

    switch (type) {
      case 'commit':
        fillStyle = COLORS.REACT_COMMIT;
        hoveredFillStyle = COLORS.REACT_COMMIT_HOVER;
        groupSelectedFillStyle = COLORS.REACT_COMMIT_SELECTED;
        break;
      case 'render-idle':
        // We could render idle time as diagonal hashes.
        // This looks nicer when zoomed in, but not so nice when zoomed out.
        // color = context.createPattern(getIdlePattern(), 'repeat');
        fillStyle = COLORS.REACT_IDLE;
        hoveredFillStyle = COLORS.REACT_IDLE_HOVER;
        groupSelectedFillStyle = COLORS.REACT_IDLE_SELECTED;
        break;
      case 'render':
        fillStyle = COLORS.REACT_RENDER;
        hoveredFillStyle = COLORS.REACT_RENDER_HOVER;
        groupSelectedFillStyle = COLORS.REACT_RENDER_SELECTED;
        break;
      case 'layout-effects':
        fillStyle = COLORS.REACT_LAYOUT_EFFECTS;
        hoveredFillStyle = COLORS.REACT_LAYOUT_EFFECTS_HOVER;
        groupSelectedFillStyle = COLORS.REACT_LAYOUT_EFFECTS_SELECTED;
        break;
      case 'passive-effects':
        fillStyle = COLORS.REACT_PASSIVE_EFFECTS;
        hoveredFillStyle = COLORS.REACT_PASSIVE_EFFECTS_HOVER;
        groupSelectedFillStyle = COLORS.REACT_PASSIVE_EFFECTS_SELECTED;
        break;
      default:
        throw new Error(`Unexpected measure type "${type}"`);
    }

    const drawableRect = intersectionOfRects(measureRect, rect);
    context.fillStyle = showHoverHighlight
      ? hoveredFillStyle
      : showGroupHighlight
      ? groupSelectedFillStyle
      : fillStyle;
    context.fillRect(
      drawableRect.origin.x,
      drawableRect.origin.y,
      drawableRect.size.width,
      drawableRect.size.height,
    );
  }

  draw(context) {
    const {
      frame,
      _hoveredMeasure,
      _lanesToRender,
      _laneToMeasures,
      visibleArea,
    } = this;

    context.fillStyle = COLORS.PRIORITY_BACKGROUND;
    context.fillRect(
      visibleArea.origin.x,
      visibleArea.origin.y,
      visibleArea.size.width,
      visibleArea.size.height,
    );

    const scaleFactor = positioningScaleFactor(
      this._intrinsicSize.width,
      frame,
    );

    for (let i = 0; i < _lanesToRender.length; i++) {
      const lane = _lanesToRender[i];
      const baseY = frame.origin.y + i * REACT_LANE_HEIGHT;
      const measuresForLane = _laneToMeasures.get(lane);

      if (!measuresForLane) {
        throw new Error(
          'No measures found for a React lane! This is a bug in this profiler tool. Please file an issue.',
        );
      }

      // Draw measures
      for (let j = 0; j < measuresForLane.length; j++) {
        const measure = measuresForLane[j];
        const showHoverHighlight = _hoveredMeasure === measure;
        const showGroupHighlight =
          !!_hoveredMeasure && _hoveredMeasure.batchUID === measure.batchUID;

        this._drawSingleReactMeasure(
          context,
          visibleArea,
          measure,
          baseY,
          scaleFactor,
          showGroupHighlight,
          showHoverHighlight,
        );
      }

      // Render bottom border
      const borderFrame = {
        origin: {
          x: frame.origin.x,
          y: frame.origin.y + (i + 1) * REACT_LANE_HEIGHT - BORDER_SIZE,
        },
        size: {
          width: frame.size.width,
          height: BORDER_SIZE,
        },
      };
      if (rectIntersectsRect(borderFrame, visibleArea)) {
        const borderDrawableRect = intersectionOfRects(
          borderFrame,
          visibleArea,
        );
        context.fillStyle = COLORS.PRIORITY_BORDER;
        context.fillRect(
          borderDrawableRect.origin.x,
          borderDrawableRect.origin.y,
          borderDrawableRect.size.width,
          borderDrawableRect.size.height,
        );
      }
    }
  }

  /**
   * @private
   */
  _handleMouseMove(interaction) {
    const {
      frame,
      _intrinsicSize,
      _lanesToRender,
      _laneToMeasures,
      onHover,
      visibleArea,
    } = this;
    if (!onHover) {
      return;
    }

    const {location} = interaction.payload;
    if (!rectContainsPoint(location, visibleArea)) {
      onHover(null);
      return;
    }

    // Identify the lane being hovered over
    const adjustedCanvasMouseY = location.y - frame.origin.y;
    const renderedLaneIndex = Math.floor(
      adjustedCanvasMouseY / REACT_LANE_HEIGHT,
    );
    if (renderedLaneIndex < 0 || renderedLaneIndex >= _lanesToRender.length) {
      onHover(null);
      return;
    }
    const lane = _lanesToRender[renderedLaneIndex];

    // Find the measure in `lane` being hovered over.
    //
    // Because data ranges may overlap, we want to find the last intersecting item.
    // This will always be the one on "top" (the one the user is hovering over).
    const scaleFactor = positioningScaleFactor(_intrinsicSize.width, frame);
    const hoverTimestamp = positionToTimestamp(location.x, scaleFactor, frame);
    const measures = _laneToMeasures.get(lane);
    if (!measures) {
      onHover(null);
      return;
    }

    for (let index = measures.length - 1; index >= 0; index--) {
      const measure = measures[index];
      const {duration, timestamp} = measure;

      if (
        hoverTimestamp >= timestamp &&
        hoverTimestamp <= timestamp + duration
      ) {
        onHover(measure);
        return;
      }
    }

    onHover(null);
  }

  handleInteraction(interaction) {
    switch (interaction.type) {
      case 'mousemove':
        this._handleMouseMove(interaction);
        break;
    }
  }
}
