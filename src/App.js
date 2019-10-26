import React from 'react';
import './App.css';
import {
  geolocated
} from 'react-geolocated';
import {
  getDistance
} from 'geolib';
import moment from 'moment';
import TrpTable from './TrpTable';

class HttpError extends Error {
  constructor(response) {
    super(`${response.status} for ${response.url}`);
    this.name = 'HttpError';
    this.response = response;
  }
}

const UPDATE_LIMIT_MS = 5000;
const NUMBER_OF_TRPS = 3;

const trpQuery = `
{
  trafficRegistrationPoints {
    id
    name
    location {
      roadReference {
        shortForm
      }
      coordinates {
        latLon {
          lat
          lon
        }
      }
    }
  }
}
`

const trafficQuery = (trpIds) => {
  const from = new Date();
  from.setDate(from.getDate() - 2);
  const fromText = from.toISOString();
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const toText = to.toISOString();
  return '{' + trpIds.map(trpId =>
    `
  id${trpId}: trafficData(trafficRegistrationPointId: "${trpId}") {
    trafficRegistrationPoint {
      id
    }
    volume {
      byDay(from: "${fromText}", to: "${toText}") {
        edges {
          node {
            from
            total {
              volume
              coverage {
                percentage
              }
            }
          }
        }
      }
      average {
        daily {
          byYear {
            year
            total {
              coverage {
                percentage
              }
              volume {
                average
              }
            }
          }
        }
      }
    }
  }
`) + '}';
};

const graphQlQuery = (query) => {
  return fetch('https://www.vegvesen.no/trafikkdata/api/', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query
    })
  })
    .then(res => res.json());
};

class App extends React.Component {

  state = {
    roadReference: null,
    error: null,
    trps: null,
    trpsWithDistance: null,
    trpTraffic: {},
    municipalities: null,
    municipality: null,
  }

  constructor() {
    super()
    this.lastUpdate = null;
  }

  componentDidMount() {
    graphQlQuery(trpQuery)
      .then(data => {
        this.onNewTrps(data.data.trafficRegistrationPoints);
      })
      .catch(console.log);
    fetch("https://www.vegvesen.no/nvdb/api/v2/omrader/kommuner.json")
      .then(res => {
        if (res.ok) {
          return res.json();
        } else {
          throw new HttpError(res);
        }
      })
      .then((data) => this.onNewRoadReference(this.state.roadReference,
        data))
      .catch(console.log);
  }

  onNewTrps(trps) {
    this.setState({
      trps: trps
    });
    if (trps && this.props.coords) {
      const trpsWithDistance = trps.map(trp => {
        return {
          trp,
          distance: getDistance({
            latitude: this.props.coords.latitude,
            longitude: this.props.coords.longitude
          }, {
            latitude: trp.location.coordinates.latLon.lat,
            longitude: trp.location.coordinates.latLon.lon
          })
        };
      })
        .sort((a, b) => a.distance < b.distance ? -1 : 1);
      this.setState({ trpsWithDistance });
      const trpsMissingData = trpsWithDistance
        .slice(0, NUMBER_OF_TRPS)
        .map(trp => trp.trp)
        .filter(trp => !(trp.id in this.state.trpTraffic));
      this.getTrafficData(trpsMissingData);
    }
  }

  onNewRoadReference(roadReference, municipalities) {
    if (roadReference && municipalities) {
      const municipality = municipalities.filter(mun => mun.nummer ===
        roadReference.vegreferanse.kommune)[0];
      this.setState({
        municipality
      });
    }
    this.setState({
      roadReference: roadReference,
      error: null,
      municipalities
    });
  }

  getTrafficData(trps) {
    if (trps.length > 0) {
      graphQlQuery(trafficQuery(trps.map(trp => trp.id)))
        .then((data) => this.onNewTraffic(data))
        .catch(console.log);
    }
  }

  onNewTraffic(data) {
    const trpTraffic = Object.assign({}, this.state.trpTraffic);
    Object.keys(data.data).forEach((key) => {
      const dataForTrp = data.data[key];
      const volume = {};
      const byYear = dataForTrp.volume.average.daily.byYear;
      if (byYear.length > 0) {
        volume.ydt = byYear[byYear.length - 1];
      } else {
        volume.ydt = null;
      }
      const byDayEdges = dataForTrp.volume.byDay.edges;
      if (byDayEdges.length > 0) {
        volume.dt = byDayEdges[0].node;
      } else {
        volume.dt = null;
      }
      trpTraffic[dataForTrp.trafficRegistrationPoint.id] = volume;
    });
    this.setState({ trpTraffic });
  }

  componentDidUpdate(prevProps) {
    const now = new Date();
    console.log(this.props.coords);
    if (this.props.coords !== prevProps.coords &&
      (this.lastUpdate == null ||
        now.getTime() - this.lastUpdate.getTime() > UPDATE_LIMIT_MS)) {
      this.lastUpdate = now;
      this.onNewTrps(this.state.trps);
      fetch(
        `https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=200`
      )
        .then(res => {
          if (res.ok) {
            return res.json();
          } else {
            throw new HttpError(res);
          }
        })
        .then((data) => this.onNewRoadReference(data[0],
          this.state.municipalities))
        .catch(error => {
          if (error instanceof HttpError) {
            error.response.json()
              .then(errorJson => {
                if (errorJson[0].code === 4012) {
                  this.setState({
                    roadReference: null,
                    error: 'Ingen vegreferanser i nærheten'
                  });
                } else {
                  console.log(errorJson);
                }
              });
          } else {
            console.log(error);
          }
        });
    }
  }

  render() {
    const { trpsWithDistance, trpTraffic } = this.state;
    return (
      <div className="App">
        <h2>Nærmeste vegreferanse</h2>
        <table className="center">
          <tbody>
          <tr>
            <td></td><td>{this.state.error}</td>
          </tr>
          <tr>
            <td>Vegreferanse:</td><td>{this.state.roadReference && this.state.roadReference.vegreferanse.kortform}</td>
          </tr>
          <tr>
            <td>Avstand: </td><td>{this.state.roadReference && this.state.roadReference.avstand}m
        {this.props.coords && (<span> +/- {Math.round(this.props.coords.accuracy)}m</span>)}
            </td>
          </tr>
          <tr>
            <td>Posisjon sist oppdatert:</td><td>{moment(this.lastUpdate).format('YYYY-MM-DD hh:mm:ss')}</td>
          </tr>
          </tbody>
        </table>
        <h2>Nærmeste TRPs</h2>
        {trpsWithDistance
        ? trpsWithDistance.slice(0, NUMBER_OF_TRPS).map(trpInfo => {
          return <TrpTable key={trpInfo.trp.id} trpInfo={trpInfo} traffic={trpTraffic[trpInfo.trp.id]}></TrpTable>
        })
        : ""}
      </div>
    );
  }
}

export default geolocated({
  positionOptions: {
    enableHighAccuracy: true,
    maximumAge: UPDATE_LIMIT_MS
  },
  userDecisionTimeout: 5000,
  watchPosition: true
})(App);
