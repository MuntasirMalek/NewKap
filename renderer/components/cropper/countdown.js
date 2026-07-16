import React from 'react';
import PropTypes from 'prop-types';
import {connect, CropperContainer} from '../../containers';

const Countdown = ({countdown, countdownValue}) => {
  if (!countdown) {
    return null;
  }

  return (
    <div className="countdown-overlay">
      <div className="countdown-number">{countdownValue}</div>
      <style jsx>{`
        .countdown-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: none;
        }

        .countdown-number {
          font-size: 180px;
          font-weight: 700;
          color: white;
          text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          animation: pulse 1s ease-in-out;
        }

        @keyframes pulse {
          0% {
            transform: scale(0.5);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

Countdown.propTypes = {
  countdown: PropTypes.bool,
  countdownValue: PropTypes.number
};

export default connect(
  [CropperContainer],
  ({countdown, countdownValue}) => ({countdown, countdownValue})
)(Countdown);
