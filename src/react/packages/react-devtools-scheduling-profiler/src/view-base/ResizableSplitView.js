/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import nullthrows from 'nullthrows';
import {Surface} from './Surface';
import {View} from './View';
import {rectContainsPoint} from './geometry';
import {layeredLayout, noopLayout} from './layouter';
import {ColorView} from './ColorView';
import {clamp} from './utils/clamp';

function getColorForBarState(state) {
  // Colors obtained from Firefox Profiler
  switch (state) {
    case 'normal':
      return '#ccc';
    case 'hovered':
      return '#bbb';
    case 'dragging':
      return '#aaa';
  }
  throw new Error(`Unknown resize bar state ${state}`);
}

class ResizeBar extends View {
  _intrinsicContentSize = {
    width: 0,
    height: 5,
  };

  _interactionState = 'normal';

  constructor(surface, frame) {
    super(surface, frame, layeredLayout);
    this.addSubview(new ColorView(surface, frame, ''));
    this._updateColor();
  }

  desiredSize() {
    return this._intrinsicContentSize;
  }

  _getColorView() {
    return this.subviews[0];
  }

  _updateColor() {
    this._getColorView().setColor(getColorForBarState(this._interactionState));
  }

  _setInteractionState(state) {
    if (this._interactionState === state) {
      return;
    }
    this._interactionState = state;
    this._updateColor();
  }

  _handleMouseDown(interaction) {
    const cursorInView = rectContainsPoint(
      interaction.payload.location,
      this.frame,
    );
    if (cursorInView) {
      this._setInteractionState('dragging');
    }
  }

  _handleMouseMove(interaction) {
    const cursorInView = rectContainsPoint(
      interaction.payload.location,
      this.frame,
    );
    if (this._interactionState === 'dragging') {
      return;
    }
    this._setInteractionState(cursorInView ? 'hovered' : 'normal');
  }

  _handleMouseUp(interaction) {
    const cursorInView = rectContainsPoint(
      interaction.payload.location,
      this.frame,
    );
    if (this._interactionState === 'dragging') {
      this._setInteractionState(cursorInView ? 'hovered' : 'normal');
    }
  }

  handleInteraction(interaction) {
    switch (interaction.type) {
      case 'mousedown':
        this._handleMouseDown(interaction);
        return;
      case 'mousemove':
        this._handleMouseMove(interaction);
        return;
      case 'mouseup':
        this._handleMouseUp(interaction);
        return;
    }
  }
}

export class ResizableSplitView extends View {
  _resizingState = null;
  _layoutState;

  constructor(surface, frame, topSubview, bottomSubview) {
    super(surface, frame, noopLayout);

    this.addSubview(topSubview);
    this.addSubview(new ResizeBar(surface, frame));
    this.addSubview(bottomSubview);

    const topSubviewDesiredSize = topSubview.desiredSize();
    this._layoutState = {
      barOffsetY: topSubviewDesiredSize ? topSubviewDesiredSize.height : 0,
    };
  }

  _getTopSubview() {
    return this.subviews[0];
  }

  _getResizeBar() {
    return this.subviews[1];
  }

  _getBottomSubview() {
    return this.subviews[2];
  }

  _getResizeBarDesiredSize() {
    return nullthrows(
      this._getResizeBar().desiredSize(),
      'Resize bar must have desired size',
    );
  }

  desiredSize() {
    const topSubviewDesiredSize = this._getTopSubview().desiredSize();
    const resizeBarDesiredSize = this._getResizeBarDesiredSize();
    const bottomSubviewDesiredSize = this._getBottomSubview().desiredSize();

    const topSubviewDesiredWidth = topSubviewDesiredSize
      ? topSubviewDesiredSize.width
      : 0;
    const bottomSubviewDesiredWidth = bottomSubviewDesiredSize
      ? bottomSubviewDesiredSize.width
      : 0;

    const topSubviewDesiredHeight = topSubviewDesiredSize
      ? topSubviewDesiredSize.height
      : 0;
    const bottomSubviewDesiredHeight = bottomSubviewDesiredSize
      ? bottomSubviewDesiredSize.height
      : 0;

    return {
      width: Math.max(
        topSubviewDesiredWidth,
        resizeBarDesiredSize.width,
        bottomSubviewDesiredWidth,
      ),
      height:
        topSubviewDesiredHeight +
        resizeBarDesiredSize.height +
        bottomSubviewDesiredHeight,
    };
  }

  layoutSubviews() {
    this._updateLayoutState();
    this._updateSubviewFrames();
    super.layoutSubviews();
  }

  _updateLayoutState() {
    const {frame, visibleArea, _resizingState} = this;

    const resizeBarDesiredSize = this._getResizeBarDesiredSize();
    // Allow bar to travel to bottom of the visible area of this view but no further
    const maxPossibleBarOffset =
      visibleArea.size.height - resizeBarDesiredSize.height;
    const topSubviewDesiredSize = this._getTopSubview().desiredSize();
    const maxBarOffset = topSubviewDesiredSize
      ? Math.min(maxPossibleBarOffset, topSubviewDesiredSize.height)
      : maxPossibleBarOffset;

    let proposedBarOffsetY = this._layoutState.barOffsetY;
    // Update bar offset if dragging bar
    if (_resizingState) {
      const {mouseY, cursorOffsetInBarFrame} = _resizingState;
      proposedBarOffsetY = mouseY - frame.origin.y - cursorOffsetInBarFrame;
    }

    this._layoutState = {
      ...this._layoutState,
      barOffsetY: clamp(0, maxBarOffset, proposedBarOffsetY),
    };
  }

  _updateSubviewFrames() {
    const {
      frame: {
        origin: {x, y},
        size: {width, height},
      },
      _layoutState: {barOffsetY},
    } = this;

    const resizeBarDesiredSize = this._getResizeBarDesiredSize();

    let currentY = y;

    this._getTopSubview().setFrame({
      origin: {x, y: currentY},
      size: {width, height: barOffsetY},
    });
    currentY += this._getTopSubview().frame.size.height;

    this._getResizeBar().setFrame({
      origin: {x, y: currentY},
      size: {width, height: resizeBarDesiredSize.height},
    });
    currentY += this._getResizeBar().frame.size.height;

    this._getBottomSubview().setFrame({
      origin: {x, y: currentY},
      // Fill remaining height
      size: {width, height: height + y - currentY},
    });
  }

  _handleMouseDown(interaction) {
    const cursorLocation = interaction.payload.location;
    const resizeBarFrame = this._getResizeBar().frame;
    if (rectContainsPoint(cursorLocation, resizeBarFrame)) {
      const mouseY = cursorLocation.y;
      this._resizingState = {
        cursorOffsetInBarFrame: mouseY - resizeBarFrame.origin.y,
        mouseY,
      };
    }
  }

  _handleMouseMove(interaction) {
    const {_resizingState} = this;
    if (_resizingState) {
      this._resizingState = {
        ..._resizingState,
        mouseY: interaction.payload.location.y,
      };
      this.setNeedsDisplay();
    }
  }

  _handleMouseUp(interaction) {
    if (this._resizingState) {
      this._resizingState = null;
    }
  }

  handleInteraction(interaction) {
    switch (interaction.type) {
      case 'mousedown':
        this._handleMouseDown(interaction);
        return;
      case 'mousemove':
        this._handleMouseMove(interaction);
        return;
      case 'mouseup':
        this._handleMouseUp(interaction);
        return;
    }
  }
}
