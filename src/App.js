import React from 'react';
import './App.css';
import { geolocated } from 'react-geolocated';

class HttpError extends Error {
    constructor(response) {
        super(`${response.status} for ${response.url}`);
        this.name = 'HttpError';
        this.response = response;
    }
}

class App extends React.Component {

    state = {
        position: null,
        error: null
    }

    componentDidMount() {
    }

    componentDidUpdate(prevProps) {
        if(this.props.coords !== prevProps.coords) {
            console.log(this.props.coords);
            fetch(`https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=100`)
                .then(res => res.json())
                .then((data) => {
                    this.setState({ position: data[0] })
                })
                .catch(console.log);
        }
    }

    render () {
    return (
            <div className="App">
            <h1>Road reference app</h1>
            {this.state.position && this.state.position.vegreferanse.kortform}
        </div>
    );
    }
}

export default geolocated({
    positionOptions: {
        enableHighAccuracy: false,
    },
    userDecisionTimeout: 5000,
})(App);
