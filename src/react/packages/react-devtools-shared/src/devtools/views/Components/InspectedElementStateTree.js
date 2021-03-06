/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import {copy} from 'clipboard-js';
import * as React from 'react';
import Button from '../Button';
import ButtonIcon from '../ButtonIcon';
import KeyValue from './KeyValue';
import {alphaSortEntries, serializeDataForCopy} from '../utils';
import Store from '../../store';
import styles from './InspectedElementSharedStyles.css';

export default function InspectedElementStateTree({
  bridge,
  getInspectedElementPath,
  inspectedElement,
  store,
}) {
  const {state} = inspectedElement;

  const entries = state != null ? Object.entries(state) : null;
  if (entries !== null) {
    entries.sort(alphaSortEntries);
  }

  const isEmpty = entries === null || entries.length === 0;

  const handleCopy = () => copy(serializeDataForCopy(state));

  if (isEmpty) {
    return null;
  } else {
    return (
      <div className={styles.InspectedElementTree}>
        <div className={styles.HeaderRow}>
          <div className={styles.Header}>state</div>
          {!isEmpty && (
            <Button onClick={handleCopy} title="Copy to clipboard">
              <ButtonIcon type="copy" />
            </Button>
          )}
        </div>
        {isEmpty && <div className={styles.Empty}>None</div>}
        {!isEmpty &&
          entries.map(([name, value]) => (
            <KeyValue
              key={name}
              alphaSort={true}
              bridge={bridge}
              canDeletePaths={true}
              canEditValues={true}
              canRenamePaths={true}
              depth={1}
              getInspectedElementPath={getInspectedElementPath}
              hidden={false}
              inspectedElement={inspectedElement}
              name={name}
              path={[name]}
              pathRoot="state"
              store={store}
              value={value}
            />
          ))}
      </div>
    );
  }
}
