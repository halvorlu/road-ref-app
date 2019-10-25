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
            fetch(`https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=10`)
                .then(res => {
                    if(res.ok) {
                        return res.json();
                    } else {
                        throw new HttpError(res);
                    }
                })
                .then((data) => {
                    this.setState({ position: data[0] })
                })
                .catch(error => {
                    if(error instanceof HttpError) {
                        error.response.json().then(errorJson => {
                            if(errorJson[0].code === 4012) {
                                this.setState({ position: null,
                                                error: 'For langt fra'});
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

    render () {
    return (
            <div className="App">
            <h1>Road reference app</h1>
            <p>
            Feil: {this.state.error}
        </p>
            <p>
            Vegreferanse: {this.state.position && this.state.position.vegreferanse.kortform}
        </p>
            <p>
            Avstand: {this.state.position && this.state.position.avstand}m
        </p>
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
