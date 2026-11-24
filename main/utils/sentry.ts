'use strict';

import * as Sentry from '@sentry/electron';

// Disabled: NewKap is an independent community fork and must not send crash
// reports to Wulkano's upstream Kap Sentry DSN.
export const isSentryEnabled = false;

export default Sentry;
