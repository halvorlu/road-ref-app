import React from 'react';

const renderDayTraffic = (trp, dt) => {
  const fromDate = dt.from.split('T')[0];
  return (
    <span><a href={`https://www.vegvesen.no/trafikkdata/start/utforsk?datatype=weekVolume&display=chart&trpids=${trp.id}&from=${fromDate}`}>{dt.total.volume}</a> ({fromDate}, {Math.round(dt.total.coverage.percentage)}% dekningsgrad)</span>
  );
};

const TrpTable = ({ trpInfo, traffic }) => {
  if (!traffic) return "";
  const { trp, distance, speed } = trpInfo;
  const { ydt, dt } = traffic;

  return (
    <table className="trpTable center">
      <tbody>
        <tr>
          <td>Navn:</td><td>{trp ?
            (<a href={`http://www.vegvesen.no/trafikkdata/start/kart?trpids=${trp.id}&lat=${trp.location.coordinates.latLon.lat}&lon=${trp.location.coordinates.latLon.lon}&zoom=13`}>{trp.name}</a>) : ""}</td>
        </tr>
        <tr>
          <td>Vegreferanse:</td><td>{trp && trp.location && trp.location.roadReference && trp.location.roadReference.shortForm}</td>
        </tr>
        <tr>
          <td>Avstand:</td><td className={speed < -10 ? "green" : (speed > 10 ? "red" : "")}>{distance}m, {Math.round(speed*3.6)}km/t</td>
        </tr>
        <tr>
          <td>Siste ÅDT:</td><td>{trp && ydt && ydt.total ?
            (<span><a href={`https://www.vegvesen.no/trafikkdata/start/utforsk?datatype=averageDailyYearVolume&display=chart&trpids=${trp.id}`}>{ydt.total.volume.average}</a> ({ydt.year}, {Math.round(ydt.total.coverage.percentage)}% dekningsgrad)</span>)
            : ""}</td>
        </tr>
        <tr>
          <td>Trafikk siste dag:</td><td>{trp && dt ?
            renderDayTraffic(trp, dt)
            : ""}</td>
        </tr>
      </tbody>
    </table>
  );
};

export default TrpTable;
