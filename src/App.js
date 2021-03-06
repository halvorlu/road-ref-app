import React from 'react';
import './App.css';
import {geolocated} from 'react-geolocated';
import {getDistance} from 'geolib';
import moment from 'moment';
import TrpTable from './TrpTable';
import firebase from "firebase/app";
// Required for side-effects
import "firebase/firestore";
import * as firebaseui from "firebaseui";
import StyledFirebaseAuth from 'react-firebaseui/StyledFirebaseAuth';

// Dummy line to keep IntelliJ from removing import of firebaseui
const firebaseui_dummy = firebaseui;

class HttpError extends Error {
  constructor(response) {
    super(`${response.status} for ${response.url}`);
    this.name = 'HttpError';
    this.response = response;
  }
}

const UPDATE_LIMIT_MS = 5000;
const NUMBER_OF_TRPS = 2;
const DISTANCE_LIMIT = 20;

const trpQuery = `
{
  trafficRegistrationPoints(searchQuery: {isOperational: true}) {
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

// Initialize Cloud Firestore through Firebase
firebase.initializeApp({
  apiKey: "AIzaSyBYIvzW1BrJUhXemg-kM-cqkX05F0qrBSE",
  authDomain: "road-ref-app.firebaseapp.com",
  databaseURL: "https://road-ref-app.firebaseio.com",
  projectId: "road-ref-app",
  storageBucket: "road-ref-app.appspot.com",
  messagingSenderId: "966583763742",
  appId: "1:966583763742:web:9e79c64e3ebaea01037f0f",
  measurementId: "G-JTCYBNLD9Q"
});
//firebase.analytics();

const db = firebase.firestore();

const uiConfig = {
  signInFlow: 'redirect',
  // We will display Google and Facebook as auth providers.
  signInOptions: [
    firebase.auth.GoogleAuthProvider.PROVIDER_ID,
  ],
  callbacks: {
    // Avoid redirects after sign-in.
    signInSuccessWithAuthResult: () => false
  }
};

const getTrpDistance = (coords, trp) => {
  return getDistance({
    latitude: coords.latitude,
    longitude: coords.longitude
  }, {
    latitude: trp.location.coordinates.latLon.lat,
    longitude: trp.location.coordinates.latLon.lon
  });
}

const formatTime = (time) => {
  return moment(time).format("YYYY-MM-DD HH:mm:ss");
}

class App extends React.Component {

  state = {
    roadReference: null,
    error: null,
    trps: null,
    trpsWithDistance: null,
    trpTraffic: {},
    municipality: null,
    visitedTrps: [],
    currentTrp: null,
    isSignedIn: false,
    distanceLimit: DISTANCE_LIMIT
  }

  constructor() {
    super()
    this.handleChange = this.handleChange.bind(this);
    this.lastUpdate = null;
    this.lastCoordsTime = null;
  }

  componentWillUnmount() {
    this.unregisterAuthObserver();
  }

  componentDidMount() {
    this.unregisterAuthObserver = firebase.auth().onAuthStateChanged(
      (user) => {
        this.setState({isSignedIn: !!user});
        if (!!user) {
          this.refreshVisitedTrps();
        }
      }
    );
    graphQlQuery(trpQuery)
      .then(data => {
        this.onNewTrps(data.data.trafficRegistrationPoints);
      })
      .catch(console.log);
  }

  refreshVisitedTrps() {
    this.getUserDoc().collection("visitedTrps").get().then((querySnapshot) => {
      const datas = querySnapshot.docs.map(doc => {
        return {
          trp: doc.data().trp,
          time: doc.data().time.toDate(),
          id: doc.id
        }
      }).sort((a, b) => a.time > b.time ? 1 : -1);
      this.setState({visitedTrps: datas});
    });
  }

  onNewTrps(trps) {
    this.setState({
      trps: trps
    });
    this.onNewTrpsOrCoords(trps, this.props.coords, 1000);
  }

  onNewTrpsOrCoords(trps, prevCoords, timeSinceUpdate) {
    if (trps && this.props.coords) {
      const trpsWithDistance = trps.map(trp => {
        const newDistance = getTrpDistance(this.props.coords, trp);
        const oldDistance = getTrpDistance(prevCoords, trp);
        return {
          trp,
          distance: newDistance,
          speed: (newDistance - oldDistance) / timeSinceUpdate
        };
      })
        .sort((a, b) => a.distance < b.distance ? -1 : 1);
      this.setState({trpsWithDistance});
      const closestTrp = trpsWithDistance[0];
      const distanceLimit = parseInt(this.state.distanceLimit) || DISTANCE_LIMIT;
      if (closestTrp.distance < distanceLimit && (this.state.currentTrp == null || closestTrp.trp.id !== this.state.currentTrp.trp.id)) {
        const trpWithTime = {trp: closestTrp.trp, time: new Date(), id: null};
        const newVisited = this.state.visitedTrps.concat([trpWithTime]);
        this.setState({visitedTrps: newVisited, currentTrp: closestTrp});
        this.store("visitedTrps", trpWithTime);
      } else if (closestTrp.distance >= distanceLimit) {
        this.setState({currentTrp: null});
      }
      const trpsMissingData = trpsWithDistance
        .slice(0, NUMBER_OF_TRPS)
        .map(trp => trp.trp)
        .filter(trp => !(trp.id in this.state.trpTraffic));
      this.getTrafficData(trpsMissingData);
    }
  }

  getUserDoc() {
    return db.collection("users").doc(firebase.auth().currentUser.uid);
  }

  store(collection, object) {
    if (this.state.isSignedIn) {
      this.getUserDoc().collection(collection).add(object)
        .then(function(docRef) {
          //console.log("Document written with ID: ", docRef.id);
        })
        .catch(function(error) {
          console.error("Error adding document: ", error);
        });
    }
  }

  delete(collection, id) {
    if (this.state.isSignedIn) {
      const refreshVisitedTrps1 = this.refreshVisitedTrps.bind(this);
      this.getUserDoc().collection(collection).doc(id).delete()
        .then(function(docRef) {
          console.log("Document deleted with ID: ", id);
          refreshVisitedTrps1();
        })
        .catch(function(error) {
          console.error("Error adding document: ", error);
        });
    }
  }

  onNewRoadReference(roadReference) {
    this.setState({
      roadReference: roadReference,
      error: null
    });
  }

  onNewMunicipality(municipality) {
    this.setState({
      municipality: municipality.kommunenavn
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
    this.setState({trpTraffic});
  }

  componentDidUpdate(prevProps) {
    const now = new Date();
    if (this.props.coords !== prevProps.coords) {
      const timeSinceUpdate = (now.getTime() - (this.lastCoordsTime || now).getTime()) / 1000.0;
      this.lastCoordsTime = now;
      this.onNewTrpsOrCoords(this.state.trps, prevProps.coords || this.props.coords, timeSinceUpdate);
    }
    if (this.props.coords !== prevProps.coords &&
      (this.lastUpdate == null ||
        now.getTime() - this.lastUpdate.getTime() > UPDATE_LIMIT_MS)) {
      this.lastUpdate = now;
      fetch(`https://ws.geonorge.no/kommuneinfo/v1/punkt?koordsys=4258&nord=${this.props.coords.latitude}&ost=${this.props.coords.longitude}`)
        .then(res => {
          if (res.ok) {
            return res.json();
          } else {
            throw new HttpError(res);
          }
        })
        .then((data) => this.onNewMunicipality(data))
        .catch(console.log);
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
        .then((data) => this.onNewRoadReference(data[0]))
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

  handleChange(event) {
    this.setState({distanceLimit: event.target.value});
  }

  onDelete(id) {
    if (this.state.isSignedIn) {
      if (window.confirm("Er du sikker på at du vil slette?")) {
        this.delete("visitedTrps", id);
      }
    }

  }

  render() {
    if (!this.state.isSignedIn) {
      return <div><p>Logg inn. Ved å logge inn godtar du at passeringer av TRP blir lagret i en sentral database.</p>
        <StyledFirebaseAuth uiConfig={uiConfig} firebaseAuth={firebase.auth()}/></div>;
    }
    const {trpsWithDistance, trpTraffic} = this.state;
    const sortedTrps = this.state.visitedTrps.sort((a, b) => a.time > b.time ? -1 : 1);
    const uniqueTrps = new Set(sortedTrps.map(trp => trp.trp.id)).size;
    return (
      <div className="App">
        <table className="center">
          <tbody>
          <tr>
            <td></td>
            <td>{this.state.error}</td>
          </tr>
          <tr>
            <td>Nærmeste vegreferanse:</td>
            <td>{this.state.roadReference && this.state.roadReference.vegreferanse.kortform}</td>
          </tr>
          <tr>
            <td>Avstand:</td>
            <td>{this.state.roadReference && this.state.roadReference.avstand}m
              {this.props.coords && (<span> +/- {Math.round(this.props.coords.accuracy)}m</span>)}
            </td>
          </tr>
          <tr>
            <td>Hastighet:</td>
            <td>{(this.props.coords && Math.round(this.props.coords.speed * 3.6)) || "N/A"} km/t</td>
          </tr>
          <tr>
            <td>Vegref. sist oppdatert:</td>
            <td>{formatTime(this.lastUpdate)}</td>
          </tr>
          <tr>
            <td>Kommune:</td>
            <td>{this.state.municipality}</td>
          </tr>
          <tr>
            <td>Siste passering:</td>
            <td>{sortedTrps[0] && (sortedTrps[0].trp.name + " (" + formatTime(sortedTrps[0].time) + ")")}</td>
          </tr>
          </tbody>
        </table>
        <h2>Nærmeste TRPs</h2>
        {trpsWithDistance
          ? trpsWithDistance.slice(0, NUMBER_OF_TRPS).map(trpInfo => {
            return <TrpTable key={trpInfo.trp.id} trpInfo={trpInfo} traffic={trpTraffic[trpInfo.trp.id]}></TrpTable>
          })
          : ""}
        <h2>{sortedTrps.length} passeringer, {uniqueTrps} unike TRP-er</h2>
        <table className="center">
          <tbody>
          {sortedTrps.map((trpWithTime, i) => {
            return (<tr key={i}>
              <td>{formatTime(trpWithTime.time)}</td>
              <td>{trpWithTime.trp.name}</td>
              <td>{trpWithTime.id ? (<button onClick={() => this.onDelete(trpWithTime.id)}>Slett</button>) : ""}</td>
            </tr>)
          })
          }
          </tbody>
        </table>
        Største avstand som regnes som passering: <input size="4" type="text" value={this.state.distanceLimit}
                                                         onChange={this.handleChange}/>m
        <p className="attribution">Logget inn som {firebase.auth().currentUser.displayName}</p>
        <p className="attribution">
          Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.
        </p>
      </div>
    );
  }
}

export default geolocated({
  positionOptions: {
    enableHighAccuracy: true,
    maximumAge: 500
  },
  userDecisionTimeout: 5000,
  watchPosition: true
})(App);
